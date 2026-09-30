/**
 * Prompt for the AI failure analyzer (§15, §16, §28, §31).
 * Sections: role, task, evidence (input), output schema, rules, uncertainty handling.
 */
export const FAILURE_PROMPT_VERSIONS = ['failure-v1', 'failure-v2'] as const;
export type FailurePromptVersion = (typeof FAILURE_PROMPT_VERSIONS)[number];
/** Version used unless AI_FAILURE_PROMPT selects another (kept selectable so versions can be compared). */
export const FAILURE_PROMPT_VERSION: FailurePromptVersion =
  (FAILURE_PROMPT_VERSIONS as readonly string[]).includes(process.env.AI_FAILURE_PROMPT ?? '')
    ? (process.env.AI_FAILURE_PROMPT as FailurePromptVersion)
    : 'failure-v2';

export const FAILURE_CATEGORIES = [
  'APPLICATION_DEFECT', 'TEST_SCRIPT_DEFECT', 'TEST_DATA_DEFECT', 'ENVIRONMENT_FAILURE',
  'NETWORK_FAILURE', 'AUTHENTICATION_FAILURE', 'UNKNOWN',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const CATEGORY_DEFINITIONS: Record<FailureCategory, string> = {
  APPLICATION_DEFECT: 'the application behaves wrongly (wrong result, server error, missing feature) while the test is correct',
  TEST_SCRIPT_DEFECT: 'the test code is wrong (bad selector, missing or wrong step, wrong wait, wrong assertion logic)',
  TEST_DATA_DEFECT: 'the test logic is fine but its data is wrong or stale (expected values, credentials, fixtures)',
  ENVIRONMENT_FAILURE: 'the machine, browser, deployment or configuration is broken or unavailable',
  NETWORK_FAILURE: 'a connection could not be made or was dropped (no HTTP response)',
  AUTHENTICATION_FAILURE: 'login, token or permission problems prevented the test from proceeding',
  UNKNOWN: 'the evidence is not enough to choose; use this rather than guessing',
};

export const failureOutputSchema = {
  $id: 'failureAnalysis',
  type: 'object',
  required: ['classification', 'confidence', 'classificationReason', 'summary', 'possibleRootCause', 'evidence', 'recommendedInvestigation', 'suggestedBugTitle', 'suggestedBugDescription'],
  additionalProperties: false,
  properties: {
    classification: { enum: [...FAILURE_CATEGORIES] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    classificationReason: { type: 'string', minLength: 10 },
    summary: { type: 'string', minLength: 10 },
    possibleRootCause: { type: 'string', minLength: 10 },
    evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 5 } },
    recommendedInvestigation: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 5 } },
    suggestedBugTitle: { type: 'string', minLength: 5, maxLength: 120 },
    suggestedBugDescription: { type: 'string', minLength: 10 },
  },
} as const;

const buildSystemPrompt = (compareRule: string) => `You are a senior QA automation engineer analysing a failed Playwright test. You explain the most likely cause using only the evidence provided.

Categories:
${FAILURE_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_DEFINITIONS[c]}`).join('\n')}

Rules:
1. Use only the evidence given. Do not invent log lines, selectors, messages, or system behaviour.
${compareRule}
3. Each "evidence" item quotes or points to a concrete fact from the evidence (an error line, an action, a snapshot line, a status code).
4. Say "possible" or "likely" in summary and possibleRootCause. Never present a guess as confirmed.
5. confidence is your estimate from 0 to 1 of how well the evidence supports the classification. Use below 0.5 when evidence is thin or conflicting, and UNKNOWN when you cannot decide.
6. Browser console and network errors from third-party services are usually unrelated to the test.
7. classificationReason explains why this category fits better than the others.
8. The bug title and description are drafts for a human to review; for test or data defects, describe the fix needed in the test.
9. Answer with JSON only, matching the output schema.`;

const COMPARE_V1 = '2. Compare what the test did (TEST SOURCE, BROWSER ACTIONS) with what it expected and with what the page or API actually showed.';
const COMPARE_V2 = `${COMPARE_V1}
   - If an expected element or text is missing, first check whether the test skipped a step (for example a button that is visible in the page snapshot but was never clicked) before concluding that the selector is wrong.
   - If an assertion's expected value is wrong or outdated, check where it comes from in TEST SOURCE; a value read from test data (a data file or data object) points to TEST_DATA_DEFECT.`;

export const FAILURE_SYSTEM_PROMPTS: Record<FailurePromptVersion, string> = {
  'failure-v1': buildSystemPrompt(COMPARE_V1),
  'failure-v2': buildSystemPrompt(COMPARE_V2),
};
export const FAILURE_SYSTEM_PROMPT = FAILURE_SYSTEM_PROMPTS[FAILURE_PROMPT_VERSION];

export function buildFailurePrompt(evidenceText: string): string {
  return `EVIDENCE
${evidenceText}

TASK: Classify this failure and explain its most likely root cause.

OUTPUT SCHEMA:
{"classification":"one of the categories","confidence":0.0,"classificationReason":"...","summary":"...","possibleRootCause":"...","evidence":["..."],"recommendedInvestigation":["..."],"suggestedBugTitle":"...","suggestedBugDescription":"..."}`;
}
