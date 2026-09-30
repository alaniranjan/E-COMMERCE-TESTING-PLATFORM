import type { ApiExchangeSummary, ScreenshotInfo, Signal, TraceSummary } from './types';

/**
 * Deterministic observations from the evidence. They state facts ("HTTP 500 returned"), not verdicts.
 * "strong" signals are nearly unambiguous and are used afterwards to check the AI's classification.
 */
export function detectSignals(input: { error: string; screenshot?: ScreenshotInfo; trace?: TraceSummary; api?: ApiExchangeSummary }): Signal[] {
  const { error, screenshot, trace, api } = input;
  const signals: Signal[] = [];

  if (/browserType\.launch|missing dependencies to run browsers|Executable doesn't exist/i.test(error)) {
    signals.push({ id: 'browser-launch', strength: 'strong', suggests: 'ENVIRONMENT_FAILURE', observation: 'The browser could not be launched on this machine (missing executable or system libraries).' });
  }
  const net = error.match(/\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|socket hang up|net::ERR_[A-Z_]+)\b/);
  if (net) signals.push({ id: 'network-error', strength: 'strong', suggests: 'NETWORK_FAILURE', observation: `A network-level error occurred (${net[1]}); no HTTP response was received.` });

  const status = error.match(/Expected HTTP (\d{3}), got (\d{3})/) ?? (api?.failing ? [null, '?', String(api.failing.status)] : null);
  if (status) {
    const got = Number(status[2]);
    if (got >= 500 && got !== 502 && got !== 503 && got !== 504) {
      signals.push({ id: 'http-5xx', strength: 'strong', suggests: 'APPLICATION_DEFECT', observation: `The server answered HTTP ${got} (server-side error) to ${api?.failing?.request.split(' ').slice(0, 2).join(' ') ?? 'the request'}.` });
    } else if (got >= 502 && got <= 504) {
      signals.push({ id: 'http-gateway', strength: 'weak', suggests: 'ENVIRONMENT_FAILURE', observation: `HTTP ${got}: a gateway/availability error, often an environment or deployment problem.` });
    } else if (got === 401 || got === 403) {
      signals.push({ id: 'http-auth', strength: 'strong', suggests: 'AUTHENTICATION_FAILURE', observation: `The request was refused with HTTP ${got} (authentication/authorisation).` });
    }
  }

  const snapshot = screenshot?.pageSnapshot ?? '';
  if (/Username and password do not match|locked out/i.test(snapshot)) {
    signals.push({ id: 'login-error-visible', strength: 'weak', suggests: 'AUTHENTICATION_FAILURE', observation: 'The page shows a login error message.' });
  }

  const missing = error.match(/waiting for (getBy\w+\(['"]([^'"]+)['"][^)]*\)[^\n]*)/);
  const notFound = /Timeout \d+ms exceeded|element\(s\) not found/i.test(error);
  if (missing && notFound) {
    const wanted = missing[2];
    const similar = similarNames(wanted, snapshot);
    if (similar.length) {
      signals.push({ id: 'similar-element', strength: 'strong', suggests: 'TEST_SCRIPT_DEFECT', observation: `The locator ${missing[1].trim()} matched nothing, but the page has a similarly named element: ${similar.map((s) => `"${s}"`).join(', ')}.` });
    } else {
      signals.push({ id: 'element-missing', strength: 'weak', observation: `The locator ${missing[1].trim()} matched nothing on the page${screenshot?.visibleHeadings.length ? ` (page shows: ${screenshot.visibleHeadings.map((h) => `"${h}"`).join(', ')})` : ''}.` });
    }
  }

  const mismatch = error.match(/Expected: ([^\n]+)\n\s*Received: ([^\n]+)/);
  if (mismatch) signals.push({ id: 'value-mismatch', strength: 'weak', observation: `Assertion compared expected ${mismatch[1].trim()} with actual ${mismatch[2].trim()}.` });

  if (trace?.failedRequests.some((r) => r.includes('(third-party)'))) {
    signals.push({ id: 'third-party-noise', strength: 'weak', observation: 'Some third-party requests failed (see network); these are often unrelated to the test.' });
  }
  return signals;
}

/** Accessible names in the snapshot that are close to the wanted id (typos, case, separators). */
function similarNames(wanted: string, snapshot: string): string[] {
  const names = [...snapshot.matchAll(/- (?:button|link|textbox|heading|text) "([^"]{2,60})"/g)].map((m) => m[1]);
  const w = normalise(wanted);
  return [...new Set(names)].filter((name) => {
    const n = normalise(name);
    return n === w || (w.length >= 4 && levenshtein(n, w) <= Math.max(1, Math.floor(w.length / 4)));
  }).slice(0, 3);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
