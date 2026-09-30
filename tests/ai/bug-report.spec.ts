import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '../../fixtures/testFixtures';
import { AIProviderError } from '../../ai/AIProvider';
import { MockAIProvider } from '../../ai/MockAIProvider';
import { createAIProvider, providerSettings } from '../../ai/providerFactory';
import { BugReportGenerator, bugReportMarkdown, reportTypeFor } from '../../ai/services/BugReportGenerator';
import { saveBugReports } from '../../ai/services/bugReportStore';
import type { FailureAnalysis } from '../../ai/services/FailureAnalyzer';
import { detectSignals } from '../../analyzer/signals';
import type { FailureEvidence } from '../../analyzer/types';

const ROOT = path.resolve(__dirname, '..', '..');
const ERROR = 'Error: Expected HTTP 201, got 500\nResponse body: {"error":{"code":"INTERNAL_ERROR","message":"Unexpected server error"}}';

function evidence(): FailureEvidence {
  return {
    test: {
      key: 'k:api', testId: 'k', title: 'Place an order through the API', titlePath: ['Orders', 'Place an order through the API'],
      file: 'tests/api/order.api.spec.ts', line: 16, project: 'api', tags: ['@api', '@smoke'], status: 'failed', retry: 0, durationMs: 120,
      error: { message: `${ERROR}\nLogin used password=hunter2-secret` },
      attachments: { trace: path.join(ROOT, 'test-results', 'x', 'trace.zip') },
    },
    environment: { testEnv: 'qa', baseUrl: 'https://www.saucedemo.com', apiBaseUrl: 'http://127.0.0.1:3001', browser: 'api', runId: 'run-1' },
    api: {
      lines: ['POST /api/auth/login -> 200 (8 ms)', 'POST /api/cart/items -> 201 (5 ms)', 'POST /api/orders -> 500 (7 ms)'],
      failing: { request: 'POST /api/orders {"shipping":{}}', status: 500, body: '{"error":{"code":"INTERNAL_ERROR","message":"Unexpected server error"}}' },
    },
    logs: [],
    signals: detectSignals({ error: ERROR }),
    collectionNotes: [],
  };
}

const analysis = { status: 'analyzed', classification: 'APPLICATION_DEFECT', confidenceLabel: 'AI confidence estimate: 80%', summary: 'Likely: server error.', possibleRootCause: 'Possible cause: the order service failed.', conflicts: [] } as unknown as FailureAnalysis;

const modelDraft = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  title: 'Placing an order returns HTTP 500 Internal Server Error',
  summary: 'Submitting an order through the API fails with a server error instead of creating the order.',
  preconditions: ['A registered user is logged in', 'The cart contains one product'],
  stepsToReproduce: ['Log in as a registered user', 'Add a product to the cart', 'Submit an order with valid shipping details'],
  expectedResult: 'The order is created and the API returns HTTP 201',
  actualResult: 'The API returns HTTP 500 with "Unexpected server error"',
  severity: 'critical', severityReason: 'Customers cannot place orders.',
  priority: 'P1', priorityReason: 'Blocks the purchase flow.',
  additionalInvestigation: ['Check the order service logs for the failing request'],
  ...overrides,
});

function generator(answers: Array<string | Error>) {
  const provider = new MockAIProvider(providerSettings({ model: 'mock', knownSecrets: ['hunter2-secret'] }));
  let i = 0;
  provider.respondWith(() => answers[Math.min(i++, answers.length - 1)]);
  return { provider, gen: new BugReportGenerator(provider, { projectRoot: ROOT }) };
}

test.describe('AI bug report generator', { tag: ['@ai', '@regression'] }, () => {
  test('report type follows the analysis classification', async () => {
    expect(reportTypeFor('APPLICATION_DEFECT')).toBe('PRODUCT BUG');
    expect(reportTypeFor('TEST_SCRIPT_DEFECT')).toBe('TEST MAINTENANCE');
    expect(reportTypeFor('TEST_DATA_DEFECT')).toBe('TEST MAINTENANCE');
    expect(reportTypeFor('NETWORK_FAILURE')).toBe('INFRASTRUCTURE');
    expect(reportTypeFor('AUTHENTICATION_FAILURE')).toBe('NEEDS TRIAGE');
    expect(reportTypeFor(undefined)).toBe('NEEDS TRIAGE');
  });

  test('draft combines exact facts with the AI narrative and is never submitted', async () => {
    const { gen } = generator([modelDraft()]);

    const d = await gen.generate(evidence(), analysis);

    expect(d).toMatchObject({
      status: 'draft', submitted: false, aiStatus: 'generated', reportType: 'PRODUCT BUG',
      title: 'Placing an order returns HTTP 500 Internal Server Error', severity: 'critical', priority: 'P1',
      classification: 'APPLICATION_DEFECT', possibleRootCause: 'Possible cause: the order service failed.',
    });
    expect(d.recordedActions).toEqual(['POST /api/auth/login -> 200 (8 ms)', 'POST /api/cart/items -> 201 (5 ms)', 'POST /api/orders -> 500 (7 ms)']);
    expect(d.environment).toMatchObject({ 'Browser / project': 'api', 'Test environment': 'qa', 'API URL': 'http://127.0.0.1:3001', Test: 'tests/api/order.api.spec.ts:16', Run: 'run-1' });
    expect(d.evidence.map((e) => e.label)).toEqual(['Playwright trace', 'Failing API call', 'Rule-based observation']);
    expect(d.evidence[0].value).toContain('npx playwright show-trace test-results/x/trace.zip');
    expect(d.rawError).toContain('Expected HTTP 201, got 500');
    expect(d.warnings).toEqual([]);
  });

  test('prompt carries the report type, tags, analysis and evidence; secrets never reach the model', async () => {
    const { gen, provider } = generator([modelDraft()]);

    await gen.generate(evidence(), analysis);

    const { system, prompt } = provider.requests[0];
    expect(system).toContain('Never include passwords');
    expect(prompt).toContain('REPORT TYPE: PRODUCT BUG');
    expect(prompt).toContain('TEST TAGS: @api @smoke');
    expect(prompt).toContain('Possible cause: the order service failed.');
    expect(prompt).toContain('POST /api/orders -> 500');
    expect(prompt).not.toContain('hunter2-secret');
  });

  test('Markdown has every §17 section, the draft notice, and no secrets', async () => {
    const { gen } = generator([modelDraft()]);
    const md = bugReportMarkdown(await gen.generate(evidence(), analysis));

    for (const heading of ['## Summary', '## Environment', '## Preconditions', '## Steps to Reproduce', '## Expected Result', '## Actual Result', '## Evidence', '## Severity (suggestion)', '## Priority (suggestion)', '## Possible Root Cause', '## Additional Investigation', '## Recorded actions']) {
      expect(md).toContain(heading);
    }
    expect(md).toContain('Nothing has been submitted to any issue tracker');
    expect(md).toContain('1. Log in as a registered user');
    expect(md).not.toContain('hunter2-secret');
  });

  test('possibly invented messages and extra steps are flagged for the reviewer', async () => {
    const { gen } = generator([modelDraft({
      actualResult: 'The page shows "Payment gateway timeout"',
      stepsToReproduce: [...['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((s) => `Step ${s}`), "Click getByTestId('checkout')"],
    })]);

    const d = await gen.generate(evidence(), analysis);

    expect(d.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('"Payment gateway timeout" does not appear in the evidence'),
      expect.stringContaining('7 steps but only 3 actions were recorded'),
      '1 step(s) contain code or selectors; steps should be plain language for a person.',
    ]));
  });

  test('test-maintenance report rated critical gets a review note', async () => {
    const { gen } = generator([modelDraft()]);
    const d = await gen.generate(evidence(), { ...analysis, classification: 'TEST_SCRIPT_DEFECT' } as FailureAnalysis);

    expect(d.reportType).toBe('TEST MAINTENANCE');
    expect(d.warnings).toContainEqual(expect.stringContaining('Critical severity on a test-maintenance report'));
  });

  test('model offline: factual draft still produced, clearly marked', async () => {
    const { gen } = generator([new AIProviderError('UNAVAILABLE', 'offline')]);

    const d = await gen.generate(evidence());

    expect(d).toMatchObject({ aiStatus: 'unavailable', submitted: false, reportType: 'NEEDS TRIAGE' });
    expect(d.title).toBe('[api] Place an order through the API: Error: Expected HTTP 201, got 500');
    expect(d.recordedActions).toHaveLength(3);
    expect(d.warnings).toContain('No AI failure analysis was available; report type needs manual triage.');
    const md = bugReportMarkdown(d);
    expect(md).toContain('AI sections unavailable - AI provider is offline');
    expect(md).toContain('## Environment');
    expect(md).not.toContain('hunter2-secret');
  });

  test('invalid output twice: draft falls back to facts with the reason', async () => {
    const { gen } = generator(['Here is the bug report: it broke.', '{"title":"x"}']);

    const d = await gen.generate(evidence(), analysis);

    expect(d.aiStatus).toBe('failed');
    expect(d.aiMessage).toContain('still invalid after 2 attempts');
    expect(d.attempts).toHaveLength(2);
  });

  test('drafts are saved as Markdown + JSON with an index', async () => {
    const { gen } = generator([modelDraft()]);
    const d = await gen.generate(evidence(), analysis);
    const label = `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dir = saveBugReports(label, [d]);

    try {
      expect(fs.readdirSync(dir).sort()).toEqual(['index.json', 'place-an-order-through-the-api-api.json', 'place-an-order-through-the-api-api.md']);
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf-8'))).toEqual([expect.objectContaining({ reportType: 'PRODUCT BUG', submitted: false })]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('AI bug report generator: live model', { tag: ['@ai', '@ai-live'] }, () => {
  test.describe.configure({ timeout: 900_000 });

  test('writes a reviewable draft for a server error', async () => {
    const provider = createAIProvider();
    const health = await provider.healthCheck();
    test.skip(!health.modelAvailable, `Live AI tests skipped: ${health.message}`);

    const d = await new BugReportGenerator(provider, { projectRoot: ROOT }).generate(evidence(), analysis);

    expect(d.aiStatus, d.aiMessage).toBe('generated');
    expect(d.submitted).toBe(false);
    expect(d.stepsToReproduce.length).toBeGreaterThan(0);
    expect(bugReportMarkdown(d)).not.toContain('hunter2-secret');
    await test.info().attach('bug-report.md', { body: bugReportMarkdown(d), contentType: 'text/markdown' });
    fs.writeFileSync(path.join(os.tmpdir(), 'live-bug-report.md'), bugReportMarkdown(d));
  });
});
