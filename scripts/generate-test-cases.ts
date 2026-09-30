/**
 * npm run ai:generate -- "User should be able to add a product to cart and complete checkout." [--max 5] [--types functional,negative]
 * Generates draft test cases with the configured model, prints them and saves the full result as JSON.
 */
import { createAIProvider } from '../ai/providerFactory';
import type { TestCaseType } from '../ai/prompts/testCasePrompt';
import { saveGeneration } from '../ai/services/generationStore';
import { GenerationInputError, TestCaseGenerator } from '../ai/services/TestCaseGenerator';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const requirement = process.argv[2];
  if (!requirement || requirement.startsWith('--')) throw new GenerationInputError('Usage: npm run ai:generate -- "<requirement>" [--max 5] [--types functional,negative]');
  const provider = createAIProvider();
  console.log(`Generating with ${provider.name}/${provider.model}. On CPU this can take a few minutes…\n`);

  const result = await new TestCaseGenerator(provider).generate({
    requirement,
    maxCases: arg('max') ? Number(arg('max')) : undefined,
    types: arg('types')?.split(',').map((t) => t.trim()) as TestCaseType[] | undefined,
  });
  const file = saveGeneration(result);

  for (const tc of result.testCases) {
    console.log(`${tc.id} [${tc.type}/${tc.priority}] ${tc.title}`);
    if (tc.preconditions.length) console.log(`   Pre:  ${tc.preconditions.join('; ')}`);
    tc.steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
    console.log(`   => ${tc.expectedResult}`);
    for (const w of tc.warnings) console.log(`   ! ${w}`);
    console.log();
  }
  if (result.assumptions.length) console.log(`Assumptions:\n${result.assumptions.map((a) => `  - ${a}`).join('\n')}\n`);
  for (const w of result.warnings) console.log(`Warning: ${w}`);
  console.log(`Status: ${result.status}${result.failureReason ? ` - ${result.failureReason}` : ''}`);
  console.log(`Attempts: ${result.attempts.map((a) => `${a.kind} ${a.ok ? 'ok' : 'rejected'} ${(a.durationMs / 1000).toFixed(0)}s`).join(', ')}; total ${(result.totalDurationMs / 1000).toFixed(0)}s`);
  console.log(`Saved: ${file}`);
  console.log('\nAll test cases are drafts (reviewStatus: pending) until a QA engineer reviews them.');
  if (result.status === 'failed') process.exit(1);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
