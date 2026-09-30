import fs from 'node:fs';
import path from 'node:path';
import { collectApiExchanges, collectLogs } from './LogCollector';
import { collectScreenshot } from './ScreenshotCollector';
import { detectSignals } from './signals';
import { collectTrace } from './TraceCollector';
import type { FailedTest, FailureEvidence } from './types';
import { config } from '../utils/config';

const MAX_SOURCE_LINES = 40;

/** Gathers all evidence for one failed test. Missing pieces are noted, never fatal. */
export function buildEvidence(test: FailedTest, projectRoot: string, runId?: string): FailureEvidence {
  const notes: string[] = [];
  const attempt = <T>(label: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      notes.push(`${label} could not be read: ${(err as Error).message}`);
      return undefined;
    }
  };

  const trace = test.attachments.trace ? attempt('Trace', () => collectTrace(test.attachments.trace!, [config.baseUrl, config.apiBaseUrl])) : undefined;
  if (!test.attachments.trace) notes.push('No trace was retained for this test.');
  const screenshot = attempt('Screenshot', () => collectScreenshot(test.attachments.screenshot, test.attachments.errorContext));
  const api = attempt('API log', () => collectApiExchanges(test.attachments.apiExchanges));
  const logs = attempt('Test log', () => collectLogs(test.attachments.testLog)) ?? [];
  const sourceExcerpt = attempt('Test source', () => testSourceExcerpt(test, projectRoot));

  return {
    test,
    environment: { testEnv: config.testEnv, baseUrl: config.baseUrl, apiBaseUrl: config.apiBaseUrl, browser: test.project, runId },
    sourceExcerpt,
    trace,
    screenshot,
    logs,
    api,
    signals: detectSignals({ error: test.error.message, screenshot, trace, api }),
    collectionNotes: notes,
  };
}

/**
 * Only the failing test's own body (from its declaration to its closing brace), not the whole file,
 * with the failing line marked.
 */
export function testSourceExcerpt(test: FailedTest, projectRoot: string): string | undefined {
  const file = path.join(projectRoot, test.file);
  if (!fs.existsSync(file)) return undefined;
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const start = test.line - 1;
  let depth = 0;
  let opened = false;
  let end = Math.min(lines.length - 1, start + MAX_SOURCE_LINES - 1);
  for (let i = start; i < lines.length && i < start + MAX_SOURCE_LINES; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; opened = true; }
      if (ch === '}') depth--;
    }
    if (opened && depth <= 0) { end = i; break; }
  }
  const failingLine = test.error.location && path.resolve(test.error.location.file) === path.resolve(file) ? test.error.location.line : undefined;
  return lines.slice(start, end + 1)
    .map((l, i) => `${start + i + 1 === failingLine ? '>' : ' '} ${String(start + i + 1).padStart(3)} | ${l}`)
    .join('\n');
}

/** Renders evidence as compact text for the prompt, each section capped so the total stays small. */
export function renderEvidence(e: FailureEvidence, options: { visionAttached: boolean }): string {
  const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [truncated]` : text);
  const t = e.test;
  const sections: string[] = [];

  sections.push(`TEST
Name: ${t.titlePath.join(' > ')}
File: ${t.file}:${t.line}
Project/browser: ${t.project}   Status: ${t.status}   Duration: ${t.durationMs} ms   Retry: ${t.retry}
Environment: ${e.environment.testEnv}, app ${e.environment.baseUrl}, API ${e.environment.apiBaseUrl}`);

  sections.push(`ERROR
${cap(t.error.message.trim(), 1_500)}`);

  if (e.sourceExcerpt) sections.push(`TEST SOURCE (">" marks the failing line)
${cap(e.sourceExcerpt, 2_200)}`);

  if (e.trace?.actions.length) sections.push(`BROWSER ACTIONS (in order, from the Playwright trace)
${cap(e.trace.actions.map((a, i) => `${i + 1}. ${a}`).join('\n'), 1_800)}`);

  if (e.screenshot || e.trace?.lastUrl) {
    const s = e.screenshot;
    const visual = options.visionAttached
      ? 'The screenshot image is attached.'
      : 'Visual inspection not available (text-only model). The page state below comes from the accessibility snapshot, not from pixels.';
    sections.push(`PAGE AT FAILURE
URL: ${e.trace?.lastUrl ?? 'unknown'}
Screenshot: ${s?.path ? `${path.basename(s.path)} ${s.width ?? '?'}x${s.height ?? '?'}` : 'none'}. ${visual}
${s?.pageSnapshot ? `Accessibility snapshot:\n${cap(s.pageSnapshot, 1_600)}` : 'No page snapshot available.'}`);
  }

  if (e.api) {
    sections.push(`API CALLS (from the test's request log, secrets masked)
${e.api.lines.join('\n')}${e.api.failing ? `\nFailing call: ${e.api.failing.request}\nStatus: ${e.api.failing.status}\nResponse body: ${e.api.failing.body}` : ''}`);
  }

  if (e.trace && (e.trace.consoleErrors.length || e.trace.failedRequests.length)) {
    sections.push(`BROWSER CONSOLE AND NETWORK (may include unrelated background errors)
${[...e.trace.consoleErrors, ...e.trace.failedRequests].slice(0, 8).join('\n')}`);
  }

  if (e.logs.length) sections.push(`TEST LOG
${cap(e.logs.join('\n'), 1_200)}`);

  if (e.signals.length) sections.push(`AUTOMATED OBSERVATIONS (facts computed without AI)
${e.signals.map((s) => `- ${s.observation}`).join('\n')}`);

  if (e.collectionNotes.length) sections.push(`EVIDENCE GAPS
${e.collectionNotes.map((n) => `- ${n}`).join('\n')}`);

  return sections.join('\n\n');
}
