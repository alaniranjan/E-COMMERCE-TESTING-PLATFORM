import fs from 'node:fs';
import AdmZip from 'adm-zip';
import type { TraceSummary } from './types';

interface TraceEvent {
  type: string;
  callId?: string;
  class?: string;
  method?: string;
  params?: Record<string, unknown>;
  title?: string;
  error?: { message?: string; error?: { message?: string } };
  messageType?: string;
  text?: string;
  snapshot?: { frameUrl?: string; request?: { method: string; url: string }; response?: { status: number } };
}

const MAX_ACTIONS = 25;
const USER_ACTIONS = new Set(['goto', 'click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'hover', 'expect', 'waitForSelector', 'reload', 'goBack']);

/**
 * Reads a Playwright trace.zip: the browser actions (with readable selectors), which action failed,
 * the last page URL, console errors and failed network requests.
 */
export function collectTrace(tracePath: string, appBaseUrls: string[]): TraceSummary | undefined {
  if (!fs.existsSync(tracePath)) return undefined;
  const zip = new AdmZip(tracePath);
  const read = (pattern: RegExp) => zip.getEntries()
    .filter((e) => pattern.test(e.entryName))
    .flatMap((e) => e.getData().toString('utf-8').split('\n'))
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) as TraceEvent; } catch { return undefined; } })
    .filter((e): e is TraceEvent => !!e);

  const events = read(/^\d+-trace\.trace$/);
  const network = read(/^\d+-trace\.network$/);

  const failedCalls = new Set(events.filter((e) => e.type === 'after' && e.error).map((e) => e.callId));
  const actions: string[] = [];
  let failedAction: string | undefined;
  for (const e of events) {
    if (e.type !== 'before' || !e.method || !USER_ACTIONS.has(e.method)) continue;
    const text = describeAction(e);
    const failed = failedCalls.has(e.callId);
    actions.push(failed ? `${text}  <-- FAILED` : text);
    if (failed) failedAction = text;
  }
  // A test that times out may never record an "after" event for the pending action.
  if (!failedAction && actions.length) failedAction = `${actions[actions.length - 1]} (last action before the failure)`;

  const lastUrl = [...events].reverse().find((e) => e.type === 'frame-snapshot' && e.snapshot?.frameUrl)?.snapshot?.frameUrl;
  const consoleErrors = unique(events.filter((e) => e.type === 'console' && (e.messageType === 'error' || e.messageType === 'warning'))
    .map((e) => `${e.messageType}: ${String(e.text).slice(0, 200)}`));

  // Hosts of the systems under test (web app and API); anything else is third-party.
  const appHosts = appBaseUrls.map(safeHost).filter((h): h is string => !!h);
  const failedRequests = unique(network
    .filter((n) => n.snapshot?.request && (n.snapshot.response?.status ?? 0) >= 400 || n.snapshot?.response?.status === -1)
    .map((n) => {
      const { method, url } = n.snapshot!.request!;
      const host = safeHost(url);
      const party = host && !appHosts.some((app) => host === app || host.endsWith(`.${app}`)) ? ' (third-party)' : '';
      return `${method} ${url.slice(0, 150)} -> ${n.snapshot!.response?.status ?? 'no response'}${party}`;
    }));

  return {
    actions: actions.length > MAX_ACTIONS ? [`… ${actions.length - MAX_ACTIONS} earlier actions omitted`, ...actions.slice(-MAX_ACTIONS)] : actions,
    failedAction,
    lastUrl,
    // Background requests finish in any order; sorting keeps the evidence identical across re-runs.
    consoleErrors: consoleErrors.sort().slice(0, 10),
    failedRequests: failedRequests.sort().slice(0, 10),
  };
}

function describeAction(e: TraceEvent): string {
  const p = e.params ?? {};
  const selector = typeof p.selector === 'string' ? readableSelector(p.selector) : '';
  switch (e.method) {
    case 'goto': return `goto ${String(p.url)}`;
    case 'fill':
    case 'type': {
      const value = /password|secret|token/i.test(String(p.selector)) ? '[REDACTED]' : JSON.stringify(p.value);
      return `fill ${selector} ${value}`;
    }
    case 'selectOption': return `selectOption ${selector} ${JSON.stringify(p.options ?? p.values ?? '')}`;
    case 'press': return `press ${selector} ${String(p.key)}`;
    case 'expect': {
      const expected = Array.isArray(p.expectedText)
        ? (p.expectedText as { string?: string; regexSource?: string }[]).map((t) => t.string ?? `/${t.regexSource}/`).join(', ')
        : p.expectedValue !== undefined ? JSON.stringify(p.expectedValue) : '';
      return `expect ${selector || 'page'} ${String(p.expression ?? '')}${expected ? ` ${expected}` : ''}${p.isNot ? ' (negated)' : ''}`;
    }
    default: return `${e.method} ${selector}`.trim();
  }
}

/** internal:testid=[data-test="checkout"s] -> getByTestId('checkout'), and similar for roles/text. */
export function readableSelector(selector: string): string {
  return selector
    .split(' >> ')
    .map((part) => part
      .replace(/^internal:testid=\[data-test="([^"]+)"s?\]$/, "getByTestId('$1')")
      .replace(/^internal:role=(\w+)\[name="([^"]+)"[is]?\]$/, "getByRole('$1', { name: '$2' })")
      .replace(/^internal:role=(\w+)$/, "getByRole('$1')")
      .replace(/^internal:has-text="([^"]+)"[is]?$/, "filter({ hasText: '$1' })")
      .replace(/^internal:text="([^"]+)"[is]?$/, "getByText('$1')")
      .replace(/^internal:label="([^"]+)"[is]?$/, "getByLabel('$1')"))
    .join(' >> ');
}

function safeHost(url: string): string | undefined {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return undefined; }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
