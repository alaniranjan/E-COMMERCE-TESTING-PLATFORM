/**
 * Prompt for the separate root-cause service (§18): several ranked possible causes, each with
 * its own evidence and confidence, plus checks a human can run to confirm or rule them out.
 */
export const ROOT_CAUSE_PROMPT_VERSION = 'rootcause-v1';

export const rootCauseOutputSchema = {
  $id: 'rootCauseAnalysis',
  type: 'object',
  required: ['possibleCauses', 'recommendedChecks'],
  additionalProperties: false,
  properties: {
    possibleCauses: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        required: ['cause', 'evidence', 'confidence'],
        additionalProperties: false,
        properties: {
          cause: { type: 'string', minLength: 10 },
          evidence: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 5 } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    recommendedChecks: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 5 } },
  },
} as const;

export const ROOT_CAUSE_SYSTEM_PROMPT = `You are a senior QA engineer doing root-cause analysis of a failed automated test.

Rules:
1. List up to 3 possible causes, most likely first. Each has evidence quoted from the input and a confidence from 0 to 1.
2. Causes are possibilities, not facts: word them as "possibly" / "likely". Confidences of different causes should reflect that only one is usually true.
3. Use only the evidence given. Do not invent logs, services, or events.
4. recommendedChecks are concrete things a human can inspect to confirm or rule out each cause.
5. Answer with JSON only, matching the output schema.`;

export function buildRootCausePrompt(evidenceText: string): string {
  return `EVIDENCE
${evidenceText}

TASK: List the possible root causes of this failure and the checks that would confirm them.

OUTPUT SCHEMA:
{"possibleCauses":[{"cause":"...","evidence":["..."],"confidence":0.0}],"recommendedChecks":["..."]}`;
}
