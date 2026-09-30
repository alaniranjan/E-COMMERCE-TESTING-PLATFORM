import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { test, expect } from '../../fixtures/testFixtures';
import { AIProviderError, type AIHealth } from '../../ai/AIProvider';
import { MockAIProvider } from '../../ai/MockAIProvider';
import { createAIProvider, providerSettings } from '../../ai/providerFactory';
import { attachToAllure } from '../../ai/services/analysisStore';
import { calibrateConfidence, ensureHedged, isGrounded } from '../../ai/services/analysisGuards';
import { FailureAnalyzer } from '../../ai/services/FailureAnalyzer';
import { RootCauseAnalyzer } from '../../ai/services/RootCauseAnalyzer';
import { renderEvidence, testSourceExcerpt } from '../../analyzer/EvidenceBuilder';
import { collectApiExchanges, collectLogs } from '../../analyzer/LogCollector';
import { collectScreenshot, pageSnapshotFrom } from '../../analyzer/ScreenshotCollector';
import { detectSignals } from '../../analyzer/signals';
import { parseFailedTests } from '../../analyzer/TestResultParser';
import { collectTrace, readableSelector } from '../../analyzer/TraceCollector';
import type { FailedTest, FailureEvidence } from '../../analyzer/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'failure-analysis-'));
const ndjson = (events: object[]) => events.map((e) => JSON.stringify(e)).join('\n');

function traceZip(dir: string): string {
  const zip = new AdmZip();
  zip.addFile('1-trace.trace', Buffer.from(ndjson([
    { type: 'before', callId: 'c1', method: 'goto', params: { url: '/' } },
    { type: 'after', callId: 'c1' },
    { type: 'before', callId: 'c2', method: 'fill', params: { selector: 'internal:testid=[data-test="password"s]', value: 'hunter2-secret' } },
    { type: 'after', callId: 'c2' },
    { type: 'before', callId: 'c3', method: 'click', params: { selector: 'internal:testid=[data-test="chekout"s]' } },
    { type: 'after', callId: 'c3', error: { message: 'Timeout' } },
    { type: 'frame-snapshot', snapshot: { frameUrl: 'https://www.saucedemo.com/cart.html' } },
    { type: 'console', messageType: 'error', text: 'Failed to load resource: 401' },
  ])));
  zip.addFile('1-trace.network', Buffer.from(ndjson([
    { type: 'resource-snapshot', snapshot: { request: { method: 'POST', url: 'https://events.backtrace.io/submit' }, response: { status: 401 } } },
    { type: 'resource-snapshot', snapshot: { request: { method: 'POST', url: 'http://127.0.0.1:3001/api/orders' }, response: { status: 500 } } },
    { type: 'resource-snapshot', snapshot: { request: { method: 'GET', url: 'https://www.saucedemo.com/' }, response: { status: 200 } } },
  ])));
  const file = path.join(dir, 'trace.zip');
  zip.writeZip(file);
  return file;
}

const SNAPSHOT_MD = '# Error details\n```yaml\n- banner:\n  - text: "Your Cart"\n- main:\n  - button "Continue Shopping"\n  - button "Checkout"\n- contentinfo:\n  - link "Facebook"\n```\n';

function failedTest(overrides: Partial<FailedTest> = {}): FailedTest {
  return {
    key: 'abc:chromium', testId: 'abc', title: 'Proceed to checkout', titlePath: ['Cart', 'Proceed to checkout'],
    file: 'tests/ui/cart.spec.ts', line: 10, project: 'chromium', tags: ['@ui'], status: 'failed', retry: 0, durationMs: 6000,
    error: { message: "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByTestId('chekout')" },
    attachments: {},
    ...overrides,
  };
}

function evidence(overrides: Partial<FailureEvidence> = {}): FailureEvidence {
  const snapshot = pageSnapshotFrom(SNAPSHOT_MD);
  const test = failedTest();
  const screenshot = { path: '', bytes: 0, pageSnapshot: snapshot, visibleHeadings: ['Your Cart'] };
  return {
    test,
    environment: { testEnv: 'qa', baseUrl: 'https://www.saucedemo.com', apiBaseUrl: 'http://127.0.0.1:3001', browser: 'chromium' },
    trace: { actions: ["click getByTestId('shopping-cart-link')", "click getByTestId('chekout')  <-- FAILED"], failedAction: "click getByTestId('chekout')", lastUrl: 'https://www.saucedemo.com/cart.html', consoleErrors: [], failedRequests: [] },
    screenshot,
    logs: [],
    signals: detectSignals({ error: test.error.message, screenshot }),
    collectionNotes: [],
    ...overrides,
  };
}

const modelAnswer = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  classification: 'TEST_SCRIPT_DEFECT',
  confidence: 0.95,
  classificationReason: 'The selector does not match any element while a similarly named button exists.',
  summary: 'The click on the checkout button timed out.',
  possibleRootCause: "The selector getByTestId('chekout') has a typo.",
  evidence: ["Error: waiting for getByTestId('chekout')", 'The page has a button "Checkout"', 'Server logs show a database deadlock at 10:42'],
  recommendedInvestigation: ['Compare the selector with the data-test attribute of the Checkout button'],
  suggestedBugTitle: 'Checkout selector typo in cart test',
  suggestedBugDescription: 'Fix the test selector to getByTestId(\'checkout\').',
  ...overrides,
});

function mockProvider(answers: Array<string | Error>, health: Partial<AIHealth> = {}) {
  class Provider extends MockAIProvider {
    async healthCheck(): Promise<AIHealth> { return { ...(await super.healthCheck()), ...health }; }
  }
  const provider = new Provider(providerSettings({ model: `mock-${Math.random()}`, knownSecrets: ['hunter2-secret'] }));
  let call = 0;
  provider.respondWith(() => answers[Math.min(call++, answers.length - 1)]);
  return provider;
}

test.describe('Failure evidence collectors', { tag: ['@ai', '@regression'] }, () => {
  test('selectors are made readable', async () => {
    expect(readableSelector('internal:testid=[data-test="checkout"s]')).toBe("getByTestId('checkout')");
    expect(readableSelector('internal:testid=[data-test="inventory-item"s] >> internal:has-text="Backpack"i >> internal:role=button[name="Add to cart"i]'))
      .toBe("getByTestId('inventory-item') >> filter({ hasText: 'Backpack' }) >> getByRole('button', { name: 'Add to cart' })");
  });

  test('trace: actions in order, failed action marked, password masked, URL, console and failed requests', async () => {
    const summary = collectTrace(traceZip(tmp()), ['https://www.saucedemo.com', 'http://127.0.0.1:3001'])!;

    expect(summary.actions).toEqual(['goto /', "fill getByTestId('password') [REDACTED]", "click getByTestId('chekout')  <-- FAILED"]);
    expect(summary.failedAction).toBe("click getByTestId('chekout')");
    expect(summary.lastUrl).toBe('https://www.saucedemo.com/cart.html');
    expect(summary.consoleErrors).toEqual(['error: Failed to load resource: 401']);
    // Sorted for stable evidence; the API under test is not marked third-party.
    expect(summary.failedRequests).toEqual([
      'POST http://127.0.0.1:3001/api/orders -> 500',
      'POST https://events.backtrace.io/submit -> 401 (third-party)',
    ]);
    expect(JSON.stringify(summary)).not.toContain('hunter2-secret');
  });

  test('page snapshot drops the footer; PNG size is read from the header', async () => {
    const dir = tmp();
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(1280, 16);
    png.writeUInt32BE(720, 20);
    fs.writeFileSync(path.join(dir, 'shot.png'), png);
    fs.writeFileSync(path.join(dir, 'error-context.md'), SNAPSHOT_MD);

    const info = collectScreenshot(path.join(dir, 'shot.png'), path.join(dir, 'error-context.md'))!;

    expect(info).toMatchObject({ width: 1280, height: 720, visibleHeadings: ['Your Cart'] });
    expect(info.pageSnapshot).toContain('button "Checkout"');
    expect(info.pageSnapshot).not.toContain('Facebook');
  });

  test('logs keep warnings and recent lines; API log drops test-harness calls', async () => {
    const logs = collectLogs(ndjson([
      { level: 'INFO', action: 'test:start' },
      { level: 'WARN', action: 'slow', ms: 900 },
      { level: 'ERROR', action: 'test:end', error: 'repeats the test error' },
    ]));
    expect(logs).toEqual(['INFO test:start', 'WARN slow ms=900']);

    // Test-harness calls (fault injection) must never reach the model through the log either.
    const withHarness = collectLogs(ndjson([
      { level: 'DEBUG', action: 'api:request', method: 'POST', url: 'http://127.0.0.1:3001/__test/faults', httpStatus: 201 },
      { level: 'DEBUG', action: 'api:request', method: 'POST', url: 'http://127.0.0.1:3001/api/orders', httpStatus: 500 },
    ]));
    expect(withHarness.join('\n')).not.toContain('__test');
    expect(withHarness).toHaveLength(1);

    const api = collectApiExchanges(JSON.stringify([
      { method: 'POST', url: 'http://h/__test/faults', status: 201, durationMs: 1, requestBody: { status: 500 } },
      { method: 'POST', url: 'http://h/api/cart/items', status: 201, durationMs: 5 },
      { method: 'POST', url: 'http://h/api/orders', status: 500, durationMs: 7, responseBody: { error: { code: 'INTERNAL_ERROR' } } },
    ]))!;
    expect(api.lines).toEqual(['POST /api/cart/items -> 201 (5 ms)', 'POST /api/orders -> 500 (7 ms)']);
    expect(api.failing).toMatchObject({ status: 500, body: expect.stringContaining('INTERNAL_ERROR') });
    expect(JSON.stringify(api)).not.toContain('__test');
  });

  const signalCases: Array<[string, Parameters<typeof detectSignals>[0], string, string]> = [
    ['selector typo', { error: "Timeout 5000ms exceeded.\n  - waiting for getByTestId('chekout')", screenshot: { path: '', bytes: 0, pageSnapshot: '- button "Checkout"', visibleHeadings: [] } }, 'similar-element', 'TEST_SCRIPT_DEFECT'],
    ['server error', { error: 'Error: Expected HTTP 201, got 500' }, 'http-5xx', 'APPLICATION_DEFECT'],
    ['connection refused', { error: 'apiRequestContext.fetch: connect ECONNREFUSED 127.0.0.1:3001' }, 'network-error', 'NETWORK_FAILURE'],
    ['browser launch', { error: 'browserType.launch: Host system is missing dependencies to run browsers.' }, 'browser-launch', 'ENVIRONMENT_FAILURE'],
    ['auth refused', { error: 'Error: Expected HTTP 201, got 401' }, 'http-auth', 'AUTHENTICATION_FAILURE'],
  ];
  for (const [label, input, id, suggests] of signalCases) {
    test(`signal: ${label}`, async () => {
      expect(detectSignals(input)).toContainEqual(expect.objectContaining({ id, strength: 'strong', suggests }));
    });
  }

  test('signal: element missing with no similar name is only a weak observation', async () => {
    const signals = detectSignals({ error: "Timeout 5000ms exceeded.\n  - waiting for getByTestId('complete-header')", screenshot: { path: '', bytes: 0, pageSnapshot: '- text: "Checkout: Overview"\n- button "Finish"', visibleHeadings: ['Checkout: Overview'] } });
    expect(signals).toEqual([expect.objectContaining({ id: 'element-missing', strength: 'weak' })]);
    expect(signals[0].observation).toContain('"Checkout: Overview"');
  });

  test('test source excerpt: only the failing test, failing line marked', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'tests', 'x.spec.ts'), ["test('a', async () => {", '  await one();', '});', "test('b', async () => {", '  await two();', '  expect(x).toBe(1);', '});', "test('c', () => {});"].join('\n'));
    const t = failedTest({ file: 'tests/x.spec.ts', line: 4, error: { message: 'x', location: { file: path.join(dir, 'tests', 'x.spec.ts'), line: 6, column: 3 } } });

    const excerpt = testSourceExcerpt(t, dir)!;

    expect(excerpt).toContain("test('b'");
    expect(excerpt).toContain('>   6 |   expect(x).toBe(1);');
    expect(excerpt).not.toContain("test('a'");
    expect(excerpt).not.toContain("test('c'");
  });

  test('rendered evidence states that visual inspection was not performed by a text-only model', async () => {
    const text = renderEvidence(evidence(), { visionAttached: false });
    expect(text).toContain('Visual inspection not available (text-only model)');
    expect(text).toContain('AUTOMATED OBSERVATIONS');
    expect(renderEvidence(evidence(), { visionAttached: true })).toContain('The screenshot image is attached.');
  });

  test('failed tests are read from a Playwright JSON report (last attempt, inline attachments)', async () => {
    const dir = tmp();
    const report = {
      config: { rootDir: path.join(dir, 'tests') },
      suites: [{ title: 'cart.spec.ts', specs: [], suites: [{ title: 'Cart', specs: [{
        id: 'abc', title: 'Proceed to checkout', file: 'cart.spec.ts', line: 10,
        tests: [
          { projectName: 'chromium', status: 'unexpected', results: [
            { status: 'failed', duration: 1, retry: 0, attachments: [] },
            { status: 'failed', duration: 2, retry: 1, error: { message: '\u001b[31mboom\u001b[39m' }, attachments: [
              { name: 'trace', contentType: 'application/zip', path: '/t/trace.zip' },
              { name: 'test-log.jsonl', contentType: 'application/x-ndjson', body: Buffer.from('{"level":"INFO"}').toString('base64') },
            ] },
          ] },
          { projectName: 'firefox', status: 'expected', results: [{ status: 'passed', duration: 1, retry: 0, attachments: [] }] },
        ],
      }] }] }],
    };
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report));

    const failed = parseFailedTests(path.join(dir, 'results.json'), dir);

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ key: 'abc:chromium', titlePath: ['Cart', 'Proceed to checkout'], retry: 1, file: path.join('tests', 'cart.spec.ts'), error: { message: 'boom' } });
    expect(failed[0].attachments).toEqual(expect.objectContaining({ trace: '/t/trace.zip', testLog: '{"level":"INFO"}' }));
  });
});

test.describe('AI failure analyzer: guardrails', { tag: ['@ai', '@regression'] }, () => {
  test('hedging, grounding and confidence rules', async () => {
    expect(ensureHedged('The selector is wrong.')).toBe('Possible cause: The selector is wrong.');
    expect(ensureHedged('The selector is likely wrong.')).toBe('The selector is likely wrong.');
    expect(isGrounded("Error: waiting for getByTestId('chekout')", "waiting for getByTestId('chekout')")).toBe(true);
    expect(isGrounded('Server logs show a database deadlock at 10:42', 'waiting for getByTestId')).toBe(false);
    expect(calibrateConfidence({ modelConfidence: 0.99, classification: 'APPLICATION_DEFECT', groundedEvidence: 3, conflicts: 0 }).confidence).toBe(0.85);
    expect(calibrateConfidence({ modelConfidence: 0.9, classification: 'UNKNOWN', groundedEvidence: 3, conflicts: 0 }).confidence).toBe(0.4);
    expect(calibrateConfidence({ modelConfidence: 0.9, classification: 'APPLICATION_DEFECT', groundedEvidence: 3, conflicts: 1 }).confidence).toBe(0.5);
    expect(calibrateConfidence({ modelConfidence: 0.9, classification: 'APPLICATION_DEFECT', groundedEvidence: 0, conflicts: 0 }).confidence).toBe(0.3);
  });

  test('analysis: invented evidence removed, wording hedged, confidence capped and labelled', async () => {
    const analyzer = new FailureAnalyzer(mockProvider([modelAnswer()]), { useCache: false });

    const a = await analyzer.analyze(evidence());

    expect(a).toMatchObject({ status: 'analyzed', classification: 'TEST_SCRIPT_DEFECT', modelConfidence: 0.95, confidence: 0.85, confidenceLabel: 'AI confidence estimate: 85%', conflicts: [] });
    expect(a.removedEvidence).toEqual(['Server logs show a database deadlock at 10:42']);
    expect(a.evidence).toHaveLength(2);
    expect(a.possibleRootCause).toBe("Possible cause: The selector getByTestId('chekout') has a typo.");
    expect(a.advisoryNote).toBe('AI analysis is advisory and requires human verification.');
    expect(a.visualInspection).toBe('no screenshot');
  });

  test('a classification that contradicts a strong rule-based signal is flagged and capped', async () => {
    const analyzer = new FailureAnalyzer(mockProvider([modelAnswer({ classification: 'APPLICATION_DEFECT' })]), { useCache: false });

    const a = await analyzer.analyze(evidence());

    expect(a.conflicts).toEqual([expect.stringContaining('usually indicates TEST_SCRIPT_DEFECT; the AI chose APPLICATION_DEFECT')]);
    expect(a.confidence).toBe(0.5);
  });

  test('provider offline: "AI analysis unavailable", no exception', async () => {
    const analyzer = new FailureAnalyzer(mockProvider([new AIProviderError('UNAVAILABLE', 'offline')]), { useCache: false });

    const a = await analyzer.analyze(evidence());

    expect(a).toMatchObject({ status: 'unavailable', message: 'AI analysis unavailable - AI provider is offline.' });
    expect(a.classification).toBeUndefined();
  });

  test('invalid output twice: status failed with both attempts recorded', async () => {
    const analyzer = new FailureAnalyzer(mockProvider(['I think it is a flaky test.', '{"classification":"MAYBE"}']), { useCache: false });

    const a = await analyzer.analyze(evidence());

    expect(a.status).toBe('failed');
    expect(a.attempts).toHaveLength(2);
  });

  test('secrets in the evidence never reach the model', async () => {
    const provider = mockProvider([modelAnswer()]);
    const ev = evidence({ test: failedTest({ error: { message: "Login failed with password=hunter2-secret and Authorization: Bearer abcdefghijklmnop1234 - waiting for getByTestId('chekout')" } }) });

    await new FailureAnalyzer(provider, { useCache: false }).analyze(ev);

    const sent = provider.requests[0].prompt;
    expect(sent).not.toContain('hunter2-secret');
    expect(sent).not.toContain('abcdefghijklmnop1234');
  });

  test('screenshot is sent only to vision-capable models', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 's.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const ev = evidence({ screenshot: { path: path.join(dir, 's.png'), bytes: 8, pageSnapshot: '- button "Checkout"', visibleHeadings: [] } });

    const textOnly = mockProvider([modelAnswer()]);
    const a1 = await new FailureAnalyzer(textOnly, { useCache: false }).analyze(ev);
    expect(textOnly.requests[0].images).toBeUndefined();
    expect(a1.visualInspection).toContain('unavailable: text-only model');

    const vision = mockProvider([modelAnswer()], { supportsVision: true });
    const a2 = await new FailureAnalyzer(vision, { useCache: false }).analyze(ev);
    expect(vision.requests[0].images).toHaveLength(1);
    expect(a2.visualInspection).toBe('performed');
  });

  test('identical evidence is answered from the cache', async () => {
    const provider = mockProvider([modelAnswer()]);
    const analyzer = new FailureAnalyzer(provider);
    const ev = evidence({ test: failedTest({ title: `Cache check ${Date.now()}` }), logs: ['DEBUG api:request durationMs=12'] });

    const first = await analyzer.analyze(ev);
    const second = await analyzer.analyze(ev);

    expect(first.cached).toBe(false);
    expect(second).toMatchObject({ cached: true, classification: first.classification });
    expect(provider.requests).toHaveLength(1);

    // A re-run of the same failure differs only in timings: still a cache hit.
    const rerun = await analyzer.analyze({ ...ev, test: { ...ev.test, durationMs: ev.test.durationMs + 1234 }, logs: ['DEBUG api:request durationMs=99'] });
    const rerun2 = await analyzer.analyze({ ...ev, test: { ...ev.test, durationMs: 5 }, logs: ['DEBUG api:request durationMs=7'] });
    expect(rerun2.cached).toBe(true);
    expect(rerun.cached).toBe(true);
    expect(provider.requests).toHaveLength(1);
  });

  test('root-cause service: causes sorted, hedged, ungrounded ones get low confidence', async () => {
    const provider = mockProvider([JSON.stringify({
      possibleCauses: [
        { cause: 'The backend is down.', evidence: ['Kubernetes pod crashed'], confidence: 0.7 },
        { cause: "Selector typo getByTestId('chekout')", evidence: ["waiting for getByTestId('chekout')"], confidence: 0.9 },
      ],
      recommendedChecks: ['Inspect the Checkout button data-test attribute'],
    })]);

    const r = await new RootCauseAnalyzer(provider).analyze(evidence());

    expect(r.status).toBe('analyzed');
    expect(r.possibleCauses.map((c) => [c.cause, c.confidence])).toEqual([
      ["Possibly: Selector typo getByTestId('chekout')", 0.85],
      ['Possibly: The backend is down.', 0.3],
    ]);
  });

  test('analysis is attached to the matching failed test in Allure results', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a-result.json'), JSON.stringify({ name: 'Proceed to checkout', status: 'failed', parameters: [{ name: 'Project', value: 'chromium' }], attachments: [] }));
    fs.writeFileSync(path.join(dir, 'b-result.json'), JSON.stringify({ name: 'Proceed to checkout', status: 'failed', parameters: [{ name: 'Project', value: 'firefox' }], attachments: [] }));
    const analysis = await new FailureAnalyzer(mockProvider([modelAnswer()]), { useCache: false }).analyze(evidence());

    expect(attachToAllure(dir, { analysis })).toBe(true);

    const chromium = JSON.parse(fs.readFileSync(path.join(dir, 'a-result.json'), 'utf-8'));
    const firefox = JSON.parse(fs.readFileSync(path.join(dir, 'b-result.json'), 'utf-8'));
    expect(chromium.attachments).toEqual([expect.objectContaining({ name: 'AI failure analysis', type: 'text/markdown' })]);
    expect(firefox.attachments).toEqual([]);
    expect(fs.readFileSync(path.join(dir, chromium.attachments[0].source), 'utf-8')).toContain('AI confidence estimate: 85%');
  });
});

test.describe('AI failure analyzer: live model', { tag: ['@ai', '@ai-live'] }, () => {
  test.describe.configure({ timeout: 900_000 });

  test('classifies a clear connection failure', async () => {
    const provider = createAIProvider();
    const health = await provider.healthCheck();
    test.skip(!health.modelAvailable, `Live AI tests skipped: ${health.message}`);
    const error = 'Error: apiRequestContext.fetch: connect ECONNREFUSED 127.0.0.1:3001\nCall log:\n  - → GET http://127.0.0.1:3001/api/products';
    const ev = evidence({
      test: failedTest({ title: 'GET /products returns the catalog', project: 'api', error: { message: error } }),
      trace: undefined, screenshot: undefined, signals: detectSignals({ error }),
    });

    const a = await new FailureAnalyzer(provider, { useCache: false }).analyze(ev);

    expect(a.status, a.message).toBe('analyzed');
    expect(['NETWORK_FAILURE', 'ENVIRONMENT_FAILURE']).toContain(a.classification);
    expect(a.confidence).toBeLessThanOrEqual(0.85);
    await test.info().attach('analysis.json', { body: JSON.stringify(a, null, 2), contentType: 'application/json' });
  });
});
