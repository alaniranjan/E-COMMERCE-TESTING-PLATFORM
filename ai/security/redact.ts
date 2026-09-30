/**
 * Removes secrets and personal data from text before it is sent to any LLM (§29).
 * Deliberately over-redacts: a masked hash is harmless, a leaked token is not.
 */
export interface RedactionResult {
  text: string;
  redactions: number;
}

interface Rule {
  name: string;
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
  /** Optional extra check to cut false positives (e.g. Luhn for card numbers). */
  accept?: (match: string) => boolean;
}

const RULES: Rule[] = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: '[REDACTED_PRIVATE_KEY]' },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: 'Bearer [REDACTED]' },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, replace: '[REDACTED_JWT]' },
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[REDACTED_AWS_KEY]' },
  // key: value / key=value / "key": "value" for secret-looking keys
  {
    name: 'secret-field',
    pattern: /(\b(?:password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|authorization)\b["']?\s*[:=]\s*["']?)([^"'\s,;}&]+)/gi,
    replace: (_m, key: string) => `${key}[REDACTED]`,
  },
  { name: 'url-credentials', pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, replace: (_m, scheme: string) => `${scheme}[REDACTED]@` },
  // Long hex strings: session tokens, API keys (also catches hashes, which is acceptable).
  { name: 'hex-token', pattern: /\b[0-9a-f]{32,}\b/gi, replace: '[REDACTED_TOKEN]' },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: '[REDACTED_EMAIL]' },
  { name: 'card-number', pattern: /\b(?:\d[ -]?){12,18}\d\b/g, replace: '[REDACTED_CARD]', accept: (m) => luhn(m.replace(/\D/g, '')) },
];

/**
 * @param knownSecrets exact values to mask wherever they appear (e.g. passwords from .env).
 */
export function redactSecrets(input: string, knownSecrets: string[] = []): RedactionResult {
  let text = input;
  let redactions = 0;

  // Exact known values first, longest first so overlapping secrets mask fully.
  for (const secret of [...new Set(knownSecrets)].filter((s) => s && s.length >= 4).sort((a, b) => b.length - a.length)) {
    const parts = text.split(secret);
    if (parts.length > 1) {
      redactions += parts.length - 1;
      text = parts.join('[REDACTED]');
    }
  }

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...groups: unknown[]) => {
      if (match.includes('[REDACTED')) return match;
      if (rule.accept && !rule.accept(match)) return match;
      redactions++;
      return typeof rule.replace === 'string' ? rule.replace : rule.replace(match, ...(groups as string[]));
    });
  }
  return { text, redactions };
}

/** Keeps the start and end (where errors and their causes usually are) and removes the middle. */
export function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const marker = `\n…[truncated ${text.length - maxChars} characters]…\n`;
  const keep = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(keep * 0.6);
  return { text: text.slice(0, head) + marker + text.slice(text.length - (keep - head)), truncated: true };
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
