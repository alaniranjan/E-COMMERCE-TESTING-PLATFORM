/** Deterministic checks applied to every AI analysis before anyone sees it (§15, §31). */

const HEDGE = /\b(possibl[ey]|likely|probabl[ey]|may|might|could|appears?|seems?|suggests?|potential(ly)?)\b/i;
const STOPWORDS = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'test', 'page', 'which', 'were', 'when', 'there', 'than', 'then', 'into', 'shows', 'showed', 'shown', 'error', 'failed', 'because', 'while', 'after', 'before', 'should', 'would', 'expected', 'actual']);

export const MAX_CONFIDENCE = 0.85;

/** Adds "Possible cause:" when the model states a guess as fact. */
export function ensureHedged(text: string, prefix = 'Possible cause:'): string {
  return HEDGE.test(text) ? text : `${prefix} ${text}`;
}

/**
 * An evidence item is grounded if a quoted fragment from it appears in the evidence, or if most
 * of its meaningful words do. Items that fail this are likely invented and are removed.
 */
export function isGrounded(item: string, evidenceText: string): boolean {
  const haystack = evidenceText.toLowerCase();
  const quoted = [...item.matchAll(/["'`]([^"'`]{3,120})["'`]/g)].map((m) => m[1].toLowerCase().trim());
  if (quoted.some((q) => haystack.includes(q))) return true;
  const words = (item.toLowerCase().match(/[a-z0-9_.:/-]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  if (!words.length) return false;
  const found = words.filter((w) => haystack.includes(w)).length;
  return found / words.length >= 0.6;
}

export interface ConfidenceInput {
  modelConfidence: number;
  classification: string;
  groundedEvidence: number;
  conflicts: number;
}

/** Heuristic caps; the result is an estimate for sorting and attention, never a probability (§31). */
export function calibrateConfidence(i: ConfidenceInput): { confidence: number; adjustments: string[] } {
  let confidence = Math.min(Math.max(i.modelConfidence, 0), 1);
  const adjustments: string[] = [];
  const cap = (max: number, reason: string) => {
    if (confidence > max) {
      adjustments.push(`${reason}: capped ${pct(confidence)} → ${pct(max)}`);
      confidence = max;
    }
  };
  cap(MAX_CONFIDENCE, 'AI output is never treated as near-certain');
  if (i.classification === 'UNKNOWN') cap(0.4, 'Classification is UNKNOWN');
  if (i.conflicts > 0) cap(0.5, 'Conflicts with a rule-based observation');
  if (i.groundedEvidence === 0) cap(0.3, 'No evidence item could be matched to the collected evidence');
  else if (i.groundedEvidence < 2) cap(0.6, 'Fewer than two evidence items match the collected evidence');
  return { confidence: Math.round(confidence * 100) / 100, adjustments };
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
