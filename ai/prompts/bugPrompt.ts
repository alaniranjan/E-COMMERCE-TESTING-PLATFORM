/**
 * Prompt for the AI bug report generator (§17, §28). The model writes the narrative parts of a draft;
 * facts (environment, raw error, artifacts, recorded actions) are filled in from the evidence, not by the model.
 */
export const BUG_PROMPT_VERSION = 'bug-v1';

export const SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type Severity = (typeof SEVERITIES)[number];
export type Priority = (typeof PRIORITIES)[number];

export const bugOutputSchema = {
  $id: 'bugReportDraft',
  type: 'object',
  required: ['title', 'summary', 'preconditions', 'stepsToReproduce', 'expectedResult', 'actualResult', 'severity', 'severityReason', 'priority', 'priorityReason', 'additionalInvestigation'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 10, maxLength: 120 },
    summary: { type: 'string', minLength: 20 },
    preconditions: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 3 } },
    stepsToReproduce: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 3 } },
    expectedResult: { type: 'string', minLength: 5 },
    actualResult: { type: 'string', minLength: 5 },
    severity: { enum: [...SEVERITIES] },
    severityReason: { type: 'string', minLength: 10 },
    priority: { enum: [...PRIORITIES] },
    priorityReason: { type: 'string', minLength: 10 },
    additionalInvestigation: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 5 } },
  },
} as const;

export const BUG_SYSTEM_PROMPT = `You are a senior QA engineer writing a clear bug report draft from a failed automated test. A human will review it before it is filed.

Rules:
1. Use only the evidence and analysis given. Do not invent steps, pages, messages, data or behaviour.
2. stepsToReproduce: numbered-style plain-language steps a person can follow, based on the BROWSER ACTIONS or API CALLS. No code, no selectors. Never include passwords. Name users only as they appear in the evidence (for example the username that was filled in, or "a newly registered user" when the API CALLS show a registration).
3. expectedResult comes from what the test asserted; actualResult from the error and the page or API state.
4. The report type is given. For a TEST MAINTENANCE task, the title and summary say that the automated test needs fixing, not that the product is broken.
5. severity: critical = blocks login, cart or purchase for users, or exposes data; major = important feature broken; minor = limited impact or has a workaround; trivial = cosmetic. For test maintenance or infrastructure reports, rate the impact on test coverage instead.
6. priority: P1 = fix now (blocks release or CI); P2 = fix in the current iteration; P3 = schedule; P4 = when convenient.
7. Give short reasons for severity and priority. These are suggestions for a human to confirm.
8. Keep the title under 100 characters, specific and neutral (no blame, no "URGENT").
9. Answer with JSON only, matching the output schema.`;

export function buildBugPrompt(input: { reportType: string; analysisText: string; evidenceText: string; tags: string[] }): string {
  return `REPORT TYPE: ${input.reportType}
TEST TAGS: ${input.tags.join(' ') || 'none'}

AI FAILURE ANALYSIS (advisory):
${input.analysisText}

EVIDENCE
${input.evidenceText}

TASK: Write the bug report draft.

OUTPUT SCHEMA:
{"title":"...","summary":"...","preconditions":["..."],"stepsToReproduce":["..."],"expectedResult":"...","actualResult":"...","severity":"major","severityReason":"...","priority":"P2","priorityReason":"...","additionalInvestigation":["..."]}`;
}
