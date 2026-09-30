/**
 * npm run ai:eval [-- --model qwen2.5:7b]
 * Measures the failure analyzer (engineered prompt + guardrails) on the held-out labelled cases in
 * ai/eval/failure-cases.json. These cases are never used to tune prompts, so the result is a fair
 * estimate; compare with the plain-prompt baseline from npm run ai:benchmark.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAIProvider } from '../ai/providerFactory';
import { FAILURE_PROMPT_VERSION } from '../ai/prompts/failurePrompt';
import { FailureAnalyzer } from '../ai/services/FailureAnalyzer';
import { detectSignals } from '../analyzer/signals';
import type { FailureEvidence } from '../analyzer/types';
import { config } from '../utils/config';

interface EvalCase { id: string; expected: string; failure: string }

function evidenceFor(c: EvalCase): FailureEvidence {
  const [first, ...rest] = c.failure.split('\n');
  const error = rest.join('\n');
  return {
    test: {
      key: c.id, testId: c.id, title: first.replace(/^Test:\s*/, ''), titlePath: [first.replace(/^Test:\s*/, '')],
      file: 'eval', line: 0, project: 'eval', tags: [], status: 'failed', retry: 0, durationMs: 0, error: { message: error }, attachments: {},
    },
    environment: { testEnv: config.testEnv, baseUrl: config.baseUrl, apiBaseUrl: config.apiBaseUrl, browser: 'eval' },
    logs: [],
    signals: detectSignals({ error }),
    collectionNotes: ['Evaluation case: only the error description is available (no trace, screenshot or source).'],
  };
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--model');
  const provider = createAIProvider(undefined, i > -1 ? { model: process.argv[i + 1] } : {});
  const health = await provider.healthCheck();
  if (!health.modelAvailable) throw new Error(health.message);
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ai', 'eval', 'failure-cases.json'), 'utf-8')) as { cases: EvalCase[] };
  const analyzer = new FailureAnalyzer(provider, { useCache: false });
  console.log(`Evaluating ${provider.model} with prompt ${FAILURE_PROMPT_VERSION} on ${cases.length} held-out cases\n`);

  const rows: { ok: boolean; confidence: number }[] = [];
  for (const c of cases) {
    const a = await analyzer.analyze(evidenceFor(c));
    const ok = a.classification === c.expected;
    rows.push({ ok, confidence: a.confidence ?? 0 });
    console.log(`  ${ok ? '✓' : '✗'} ${c.id} expected ${c.expected.padEnd(22)} got ${String(a.classification ?? a.status).padEnd(22)} ${a.confidenceLabel ?? ''}${a.conflicts.length ? ' [conflict]' : ''} ${Math.round(a.durationMs / 1000)}s`);
  }
  const avg = (xs: number[]) => (xs.length ? `${Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100)}%` : '—');
  console.log(`\naccuracy ${rows.filter((r) => r.ok).length}/${rows.length}`);
  console.log(`avg confidence when correct ${avg(rows.filter((r) => r.ok).map((r) => r.confidence))}, when wrong ${avg(rows.filter((r) => !r.ok).map((r) => r.confidence))}`);
}

main().catch((err) => { console.error((err as Error).message); process.exit(1); });
