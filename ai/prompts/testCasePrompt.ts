/**
 * Prompt for the AI test-case generator (§13, §14, §28).
 * Sections: role, task, input, output schema, rules, one example, uncertainty handling.
 * Kept compact on purpose: on CPU the model reads ~28 tokens/s, so every sentence costs time.
 */
export const TEST_CASE_PROMPT_VERSION = 'testcase-v2';

export const TEST_CASE_TYPES = ['functional', 'negative', 'boundary', 'validation', 'security', 'api', 'ui', 'regression', 'smoke'] as const;
export type TestCaseType = (typeof TEST_CASE_TYPES)[number];
export const PRIORITIES = ['high', 'medium', 'low'] as const;

/** Five types for the default five cases, so full coverage is possible. */
export const DEFAULT_TYPES: TestCaseType[] = ['functional', 'negative', 'boundary', 'validation', 'api'];

/** JSON Schema of the model output. Also sent to Ollama as a structured-output constraint. */
export function testCaseOutputSchema(maxCases: number) {
  return {
    $id: `generatedTestCases-${maxCases}`,
    type: 'object',
    required: ['testCases', 'assumptions'],
    additionalProperties: false,
    properties: {
      testCases: {
        type: 'array',
        minItems: 1,
        maxItems: maxCases,
        items: {
          type: 'object',
          required: ['id', 'title', 'type', 'priority', 'preconditions', 'steps', 'expectedResult'],
          additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 5, maxLength: 150 },
            type: { enum: [...TEST_CASE_TYPES] },
            priority: { enum: [...PRIORITIES] },
            preconditions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } },
            steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 3 } },
            expectedResult: { type: 'string', minLength: 5 },
          },
        },
      },
      assumptions: { type: 'array', maxItems: 10, items: { type: 'string' } },
    },
  } as const;
}

export const EXAMPLE_TITLE = 'Logged-in user can log out from the menu';

export const TEST_CASE_SYSTEM_PROMPT = `You are a senior QA engineer. You write clear, automation-ready test cases for an e-commerce web application.

Rules:
1. Use only behaviour stated in the requirement or the application context. Do not invent pages, fields, buttons, messages or limits. Quote a message only if it appears in the context. If you must assume something, write it in "assumptions".
2. Every test case tests a different scenario. Do not repeat the same flow with small changes.
3. Put the starting state in preconditions (for example "User is logged in", "Cart contains one product") instead of repeating those steps. At most 6 steps, one action per step, following the real page flow.
4. The steps must match the title. A negative test's title states the expected failure, for example "Checkout is blocked when First Name is missing".
5. expectedResult is observable: text shown, page reached, value, or HTTP status.
6. Include at least one test case of each requested type if it applies to the requirement. type is one of: ${TEST_CASE_TYPES.join(', ')}.
7. priority: high = breaks login, cart or purchase; medium = important with a workaround; low = cosmetic or rare.
8. Security cases are basic checks only (for example: a page refuses access without login). Never claim a test proves the system is secure.
9. Answer with JSON only, matching the output schema. No markdown, no comments.`;

export interface TestCasePromptInput {
  requirement: string;
  appContext: string;
  maxCases: number;
  types: readonly TestCaseType[];
}

export function buildTestCasePrompt({ requirement, appContext, maxCases, types }: TestCasePromptInput): string {
  return `APPLICATION CONTEXT:
${appContext.trim()}

REQUIREMENT:
${requirement.trim()}

TASK: Write up to ${maxCases} test cases for the requirement. Cover these types where they apply: ${types.join(', ')}. Number ids TC001, TC002, ...

OUTPUT SCHEMA:
{"testCases":[{"id":"TC001","title":"...","type":"functional","priority":"high","preconditions":["..."],"steps":["..."],"expectedResult":"..."}],"assumptions":["..."]}

EXAMPLE (different requirement: "User can log out"):
{"testCases":[{"id":"TC001","title":"${EXAMPLE_TITLE}","type":"functional","priority":"high","preconditions":["User is logged in as standard_user"],"steps":["Open the menu","Click Logout"],"expectedResult":"Login page is shown with an empty username field"}],"assumptions":[]}`;
}
