/**
 * npm run ai:check [-- "your prompt"]
 * Verifies the configured AI provider end to end: reachable, model installed, capabilities,
 * then a timed prompt and a timed JSON prompt. Exit code 1 if the AI layer is not usable.
 */
import { AIProviderError } from '../ai/AIProvider';
import { createAIProvider } from '../ai/providerFactory';
import { config } from '../utils/config';

async function main(): Promise<void> {
  const provider = createAIProvider();
  console.log(`Provider: ${provider.name}   Model: ${provider.model}   Endpoint: ${config.ai.ollamaBaseUrl}`);

  const health = await provider.healthCheck();
  console.log(`Health:   ${health.modelAvailable ? 'OK' : 'NOT READY'} - ${health.message}`);
  if (!health.modelAvailable) process.exit(1);

  const prompt = process.argv[2] ?? 'In one sentence, what is the purpose of a regression test suite?';
  console.log(`\nPrompt:   ${prompt}`);
  const text = await provider.generate(prompt, { maxTokens: 120 });
  console.log(`Answer:   ${text.text.trim()}`);
  console.log(`Timing:   ${(text.durationMs / 1000).toFixed(1)} s, ${text.completionTokens ?? '?'} output tokens` +
    (text.completionTokens ? ` (${(text.completionTokens / (text.durationMs / 1000)).toFixed(1)} tokens/s incl. prompt processing)` : ''));

  const schema = {
    type: 'object',
    required: ['classification', 'reason'],
    properties: {
      classification: { enum: ['APPLICATION_DEFECT', 'TEST_SCRIPT_DEFECT', 'ENVIRONMENT_FAILURE', 'UNKNOWN'] },
      reason: { type: 'string' },
    },
  };
  const json = await provider.generateJSON(
    'A UI test waited 10 s for a button with data-test="checkout" but the page shows a button with data-test="proceed-to-checkout". Classify the likely cause.',
    { schema, maxTokens: 120, temperature: 0 },
  );
  console.log(`\nJSON:     ${JSON.stringify(json.data)}`);
  console.log(`Timing:   ${(json.response.durationMs / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  const code = err instanceof AIProviderError ? `[${err.code}] ` : '';
  console.error(`AI check failed: ${code}${(err as Error).message}`);
  process.exit(1);
});
