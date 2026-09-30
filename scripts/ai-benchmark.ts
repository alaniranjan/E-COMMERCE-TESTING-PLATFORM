/**
 * npm run ai:benchmark -- qwen2.5:3b qwen2.5:7b
 * Baseline comparison of local models on labelled failures (ai/eval/failure-cases.json):
 * JSON validity, classification accuracy and latency. Uses a deliberately plain prompt;
 * Phase 7's engineered prompts are measured against this baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAIProvider } from '../ai/providerFactory';

const CATEGORIES = ['APPLICATION_DEFECT', 'TEST_SCRIPT_DEFECT', 'TEST_DATA_DEFECT', 'ENVIRONMENT_FAILURE', 'NETWORK_FAILURE', 'AUTHENTICATION_FAILURE', 'UNKNOWN'];
const schema = {
  type: 'object',
  required: ['classification', 'reason'],
  properties: { classification: { enum: CATEGORIES }, reason: { type: 'string' } },
};

interface EvalCase { id: string; expected: string; failure: string }

async function benchmark(model: string, cases: EvalCase[]) {
  const provider = createAIProvider('ollama', { model, maxTokens: 150, temperature: 0 });
  const health = await provider.healthCheck();
  if (!health.modelAvailable) return console.log(`\n${model}: skipped - ${health.message}`);

  // Warm-up so model load time is reported separately from inference time.
  const warm = await provider.generate('Reply with: ok', { maxTokens: 3 });
  console.log(`\n${model}  (first call incl. load: ${(warm.durationMs / 1000).toFixed(1)} s)`);

  let correct = 0, validJson = 0, totalMs = 0;
  for (const c of cases) {
    const prompt = `Classify the most likely cause of this automated test failure.\nCategories: ${CATEGORIES.join(', ')}.\n\n${c.failure}`;
    try {
      const { data, response } = await provider.generateJSON<{ classification: string; reason: string }>(prompt, { schema });
      validJson++;
      totalMs += response.durationMs;
      const ok = data.classification === c.expected;
      if (ok) correct++;
      console.log(`  ${ok ? '✓' : '✗'} ${c.id} expected ${c.expected.padEnd(22)} got ${String(data.classification).padEnd(22)} ${(response.durationMs / 1000).toFixed(1)} s`);
    } catch (err) {
      console.log(`  ✗ ${c.id} error: ${(err as Error).message}`);
    }
  }
  console.log(`  accuracy ${correct}/${cases.length}, valid JSON ${validJson}/${cases.length}, avg ${(totalMs / Math.max(validJson, 1) / 1000).toFixed(1)} s per analysis`);
}

async function main() {
  const models = process.argv.slice(2);
  if (!models.length) throw new Error('Usage: npm run ai:benchmark -- <model> [model...]');
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ai', 'eval', 'failure-cases.json'), 'utf-8')) as { cases: EvalCase[] };
  for (const model of models) await benchmark(model, cases);
}

main().catch((err) => { console.error((err as Error).message); process.exit(1); });
