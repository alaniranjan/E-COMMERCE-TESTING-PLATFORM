import type { AnySchema } from 'ajv';
import { validateSchema } from '../../utils/schemaValidator';

/**
 * Turns model output into validated data without ever trusting it (§13).
 * Extraction is tried from strictest to most tolerant; the result then has to pass a JSON Schema
 * and optional semantic checks. Nothing is evaluated as code.
 */
export type ExtractionMethod = 'direct' | 'code-fence' | 'embedded' | 'repaired';

export type ParseOutcome<T> =
  | { ok: true; data: T; method: ExtractionMethod }
  | { ok: false; stage: 'extract' | 'schema' | 'semantic'; errors: string[]; method?: ExtractionMethod };

export function extractJson(text: string): { value: unknown; method: ExtractionMethod } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Response is empty' };

  const direct = tryParse(trimmed);
  if (direct.ok) return { value: direct.value, method: 'direct' };

  // ```json ... ``` (models often wrap JSON in markdown)
  for (const match of trimmed.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    const fenced = tryParse(match[1].trim());
    if (fenced.ok) return { value: fenced.value, method: 'code-fence' };
  }

  // JSON surrounded by prose: scan for balanced {...} / [...] candidates, string-aware.
  const candidates = balancedCandidates(trimmed);
  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed.ok) return { value: parsed.value, method: 'embedded' };
  }

  // Conservative repairs only: trailing commas and typographic quotes. No guessing of missing content.
  for (const candidate of [trimmed, ...candidates]) {
    const repaired = candidate
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    const parsed = tryParse(repaired);
    if (parsed.ok) return { value: parsed.value, method: 'repaired' };
  }

  const truncated = /[{[]/.test(trimmed) && candidates.length === 0;
  return { error: truncated ? 'JSON is incomplete (unbalanced brackets); the output was probably cut off' : 'No valid JSON object found in the response' };
}

export function parseAIJson<T>(text: string, schema: AnySchema, semanticCheck?: (data: T) => string[]): ParseOutcome<T> {
  const extracted = extractJson(text);
  if ('error' in extracted) return { ok: false, stage: 'extract', errors: [extracted.error] };

  const { valid, errors } = validateSchema(schema, extracted.value);
  if (!valid) return { ok: false, stage: 'schema', errors: errors.slice(0, 15), method: extracted.method };

  const semanticErrors = semanticCheck?.(extracted.value as T) ?? [];
  if (semanticErrors.length) return { ok: false, stage: 'semantic', errors: semanticErrors, method: extracted.method };

  return { ok: true, data: extracted.value as T, method: extracted.method };
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value = JSON.parse(text);
    // A bare string/number is not a useful structured answer.
    return value !== null && typeof value === 'object' ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Every balanced {...} or [...] substring, outermost first, ignoring brackets inside strings.
 * Nested candidates are kept too: when an outer block is not JSON (e.g. prose or code in braces),
 * valid JSON inside it can still be found.
 */
function balancedCandidates(text: string, limit = 200): string[] {
  const out: string[] = [];
  for (let start = 0; start < text.length && out.length < limit; start++) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    const end = findClose(text, start);
    if (end !== -1) out.push(text.slice(start, end + 1));
  }
  return out;
}

function findClose(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}
