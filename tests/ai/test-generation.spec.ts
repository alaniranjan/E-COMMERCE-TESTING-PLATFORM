import { test, expect } from '../../fixtures/testFixtures';
import { AIProviderError } from '../../ai/AIProvider';
import { MockAIProvider } from '../../ai/MockAIProvider';
import { extractJson, parseAIJson } from '../../ai/parsers/AIResponseParser';
import { createAIProvider, providerSettings } from '../../ai/providerFactory';
import { EXAMPLE_TITLE, TEST_CASE_PROMPT_VERSION, testCaseOutputSchema } from '../../ai/prompts/testCasePrompt';
import { GenerationInputError, TestCaseGenerator, ungroundedQuotes, type RawTestCase } from '../../ai/services/TestCaseGenerator';

const REQUIREMENT = 'User should be able to add a product to cart and complete checkout.';
const CONTEXT = 'Checkout information errors: "Error: First Name is required". Order complete header "Thank you for your order!".';

const validCase = (overrides: Partial<RawTestCase> = {}): RawTestCase => ({
  id: 'TC001',
  title: 'Customer completes checkout with one product',
  type: 'functional',
  priority: 'high',
  preconditions: ['User is logged in', 'Cart contains one product'],
  steps: ['Open the cart', 'Click Checkout', 'Enter valid customer details', 'Click Continue', 'Click Finish'],
  expectedResult: 'The header "Thank you for your order!" is shown',
  ...overrides,
});
const answer = (cases: RawTestCase[], assumptions: string[] = []) => JSON.stringify({ testCases: cases, assumptions });

function setup(...responses: Array<string | Error>) {
  const provider = new MockAIProvider(providerSettings({ model: 'mock-model' }));
  let call = 0;
  provider.respondWith(() => responses[Math.min(call++, responses.length - 1)]);
  const generator = new TestCaseGenerator(provider, { appContext: CONTEXT });
  return { provider, generator };
}

test.describe('AI response parser: safe JSON extraction', { tag: ['@ai', '@regression'] }, () => {
  const cases: Array<[string, string, string]> = [
    ['plain JSON', '{"a":1}', 'direct'],
    ['markdown code fence', 'Here you go:\n```json\n{"a":1}\n```\nHope this helps', 'code-fence'],
    ['prose around JSON', 'Sure! The answer is {"a":1} as requested.', 'embedded'],
    ['braces inside strings', 'Result: {"a":1,"note":"use {curly} and ] safely"} done', 'embedded'],
    ['trailing comma', '{"a":1,}', 'repaired'],
    ['typographic quotes', '{“a”: 1}', 'repaired'],
  ];
  for (const [label, text, method] of cases) {
    test(`extracts ${label}`, async () => {
      const out = extractJson(text);
      expect(out).toMatchObject({ method });
      expect((out as { value: { a: number } }).value.a).toBe(1);
    });
  }

  test('reports cut-off JSON instead of guessing', async () => {
    expect(extractJson('{"testCases":[{"id":"TC001","title":"Checko')).toEqual({
      error: expect.stringContaining('cut off'),
    });
  });

  test('never evaluates code', async () => {
    const out = extractJson('(() => { globalThis.pwned = true; return {"a":1} })()');
    expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
    expect(out).toMatchObject({ value: { a: 1 }, method: 'embedded' });
  });

  test('schema errors name the failing field', async () => {
    const out = parseAIJson(answer([validCase({ priority: 'urgent' as never, steps: [] })]), testCaseOutputSchema(5));
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ stage: 'schema' });
    const errors = (out as { errors: string[] }).errors.join('\n');
    expect(errors).toContain('/testCases/0/priority');
    expect(errors).toContain('/testCases/0/steps');
  });
});

test.describe('AI test case generator', { tag: ['@ai', '@regression'] }, () => {
  test('valid first answer: success, renumbered ids, drafts pending review', async () => {
    const { generator, provider } = setup(answer([validCase({ id: '1' }), validCase({ id: 'x', title: 'Checkout is blocked when First Name is missing', type: 'negative', expectedResult: 'Error: First Name is required is displayed' })], ['Standard user']));

    const result = await generator.generate({ requirement: REQUIREMENT, maxCases: 3, types: ['functional', 'negative'] });

    expect(result).toMatchObject({ status: 'success', assumptions: ['Standard user'], promptVersion: TEST_CASE_PROMPT_VERSION, model: 'mock-model' });
    expect(result.testCases.map((t) => t.id)).toEqual(['TC001', 'TC002']);
    expect(result.testCases.every((t) => t.reviewStatus === 'pending')).toBe(true);
    expect(result.warnings).toContain('Test case ids were renumbered.');
    expect(result.attempts).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
  });

  test('prompt contains role, rules, context, requirement, schema and example', async () => {
    const { generator, provider } = setup(answer([validCase()]));

    await generator.generate({ requirement: REQUIREMENT, maxCases: 4, types: ['functional', 'boundary'] });

    const { system, prompt, json } = provider.requests[0];
    expect(system).toContain('You are a senior QA engineer');
    expect(system).toContain('Never claim a test proves the system is secure');
    expect(prompt).toContain(CONTEXT);
    expect(prompt).toContain(REQUIREMENT);
    expect(prompt).toContain('up to 4 test cases');
    expect(prompt).toContain('functional, boundary');
    expect(prompt).toContain('OUTPUT SCHEMA');
    expect(prompt).toContain(EXAMPLE_TITLE);
    expect(json).toMatchObject({ properties: { testCases: { maxItems: 4 } } }); // structured-output constraint
  });

  test('invalid first answer is corrected by a retry that lists the problems', async () => {
    const { generator, provider } = setup('Here are your test cases: TC001 - checkout works', answer([validCase()]));

    const result = await generator.generate({ requirement: REQUIREMENT });

    expect(result.status).toBe('success');
    expect(result.attempts.map((a) => [a.kind, a.ok])).toEqual([['initial', false], ['correction', true]]);
    const correction = provider.requests[1].prompt;
    expect(correction).toContain('YOUR PREVIOUS ANSWER WAS REJECTED');
    expect(correction).toContain('No valid JSON object found');
    expect(correction).toContain('Here are your test cases');
    expect(correction).toContain(REQUIREMENT); // the retry is self-contained
    expect(result.warnings).toContain('Valid output only after 2 attempts.');
  });

  test('schema violations are sent back to the model', async () => {
    const { generator, provider } = setup(answer([validCase({ type: 'exploratory' as never })]), answer([validCase()]));

    await generator.generate({ requirement: REQUIREMENT });

    expect(provider.requests[1].prompt).toContain('/testCases/0/type must be equal to one of the allowed values');
  });

  test('cut-off output asks for fewer, shorter cases', async () => {
    const { generator, provider } = setup(answer([validCase()]).slice(0, 80), answer([validCase()]));

    await generator.generate({ requirement: REQUIREMENT });

    expect(provider.requests[1].prompt).toContain('cut off');
  });

  test('still invalid after the retry: failed, with every attempt recorded', async () => {
    const { generator } = setup('not json', '{"testCases": "also wrong"}');

    const result = await generator.generate({ requirement: REQUIREMENT });

    expect(result).toMatchObject({ status: 'failed', failureCode: 'INVALID_OUTPUT', testCases: [] });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((a) => !a.ok && a.errors.length > 0 && a.rawPreview)).toBe(true);
  });

  test('copying the prompt example is rejected', async () => {
    const { generator, provider } = setup(answer([validCase({ title: EXAMPLE_TITLE })]), answer([validCase()]));

    const result = await generator.generate({ requirement: REQUIREMENT });

    expect(provider.requests[1].prompt).toContain("copies the prompt's example");
    expect(result.status).toBe('success');
  });

  test('provider offline: failed without retrying, no exception', async () => {
    const { generator, provider } = setup(new AIProviderError('UNAVAILABLE', 'Mock: provider offline'));

    const result = await generator.generate({ requirement: REQUIREMENT });

    expect(result).toMatchObject({ status: 'failed', failureCode: 'UNAVAILABLE' });
    expect(result.failureReason).toContain('provider offline');
    expect(provider.requests).toHaveLength(1);
  });

  test('duplicates removed, overclaims and invented messages flagged for the reviewer', async () => {
    const { generator } = setup(answer([
      validCase(),
      validCase({ id: 'TC002' }), // same title
      validCase({ id: 'TC003', title: 'Login page is fully secure against attacks', type: 'security', expectedResult: 'The site guarantees no unauthorised access' }),
      validCase({ id: 'TC004', title: 'Checkout is blocked when the cart is empty', type: 'negative', expectedResult: 'Error: Your cart is empty is displayed' }),
    ]));

    const result = await generator.generate({ requirement: REQUIREMENT, types: ['functional', 'security', 'negative', 'api'] });

    expect(result.testCases).toHaveLength(3);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Removed duplicate'),
      'No test cases of type: api.',
    ]));
    expect(result.testCases[1].warnings.join()).toContain('Overstated claim');
    expect(result.testCases[2].warnings.join()).toContain('"Error: Your cart is empty" does not appear');
    expect(result.testCases[0].warnings).toEqual([]);
  });

  test('secrets in the requirement are masked before reaching the model', async () => {
    const { generator, provider } = setup(answer([validCase()]));

    await generator.generate({ requirement: 'Login with password=Sup3rS3cret! then checkout as jane@example.com' });

    expect(provider.requests[0].prompt).not.toContain('Sup3rS3cret!');
    expect(provider.requests[0].prompt).not.toContain('jane@example.com');
  });

  const badInputs: Array<[string, Record<string, unknown>]> = [
    ['too short requirement', { requirement: 'login' }],
    ['too long requirement', { requirement: 'x'.repeat(4_001) }],
    ['maxCases 0', { requirement: REQUIREMENT, maxCases: 0 }],
    ['maxCases 16', { requirement: REQUIREMENT, maxCases: 16 }],
    ['unknown type', { requirement: REQUIREMENT, types: ['exploratory'] }],
  ];
  for (const [label, input] of badInputs) {
    test(`rejects ${label} before calling the model`, async () => {
      const { generator, provider } = setup(answer([validCase()]));
      await expect(generator.generate(input as never)).rejects.toBeInstanceOf(GenerationInputError);
      expect(provider.requests).toHaveLength(0);
    });
  }

  test('grounding check: real messages pass, invented ones and apostrophes are handled', async () => {
    expect(ungroundedQuotes('Error: First Name is required is displayed', CONTEXT)).toEqual([]);
    expect(ungroundedQuotes("Shows 'Thank you for your order!'", CONTEXT)).toEqual([]);
    expect(ungroundedQuotes("The user's cart shows 'Cart is empty'", CONTEXT)).toEqual(['Cart is empty']);
  });
});

test.describe('AI test case generator: live model', { tag: ['@ai', '@ai-live'] }, () => {
  test.describe.configure({ timeout: 900_000 });

  test('generates valid draft test cases from a requirement', async () => {
    const provider = createAIProvider();
    const health = await provider.healthCheck();
    test.skip(!health.modelAvailable, `Live AI tests skipped: ${health.message}`);

    const result = await new TestCaseGenerator(provider).generate({
      requirement: 'Checkout must be blocked when the customer leaves the postal code empty.',
      maxCases: 2,
      types: ['negative', 'validation'],
    });

    expect(result.status, result.failureReason).toBe('success');
    expect(result.testCases.length).toBeGreaterThanOrEqual(1);
    for (const tc of result.testCases) {
      expect(tc.steps.length).toBeGreaterThan(0);
      expect(tc.reviewStatus).toBe('pending');
    }
    await test.info().attach('generation.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  });
});
