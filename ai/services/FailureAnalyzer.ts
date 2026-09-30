import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AIProvider } from '../AIProvider';
import {
  buildFailurePrompt, FAILURE_PROMPT_VERSION, FAILURE_SYSTEM_PROMPT, failureOutputSchema, type FailureCategory,
} from '../prompts/failurePrompt';
import { calibrateConfidence, ensureHedged, isGrounded, pct } from './analysisGuards';
import { structuredCall, type CallAttempt } from './structuredCall';
import { renderEvidence } from '../../analyzer/EvidenceBuilder';
import { screenshotBase64 } from '../../analyzer/ScreenshotCollector';
import type { FailureEvidence, Signal } from '../../analyzer/types';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

export const ADVISORY_NOTE = 'AI analysis is advisory and requires human verification.';
export const CACHE_DIR = path.resolve(__dirname, '..', '..', 'reports', 'ai-analysis', 'cache');

interface ModelFailureAnalysis {
  classification: FailureCategory;
  confidence: number;
  classificationReason: string;
  summary: string;
  possibleRootCause: string;
  evidence: string[];
  recommendedInvestigation: string[];
  suggestedBugTitle: string;
  suggestedBugDescription: string;
}

export interface FailureAnalysis {
  status: 'analyzed' | 'unavailable' | 'failed';
  /** For unavailable/failed: what to show instead of an analysis (§48). */
  message?: string;
  test: { key: string; title: string; titlePath: string[]; file: string; line: number; project: string; error: string };
  runId?: string;
  classification?: FailureCategory;
  /** Final estimate after guardrails; label it "AI confidence estimate", never "probability". */
  confidence?: number;
  confidenceLabel?: string;
  modelConfidence?: number;
  confidenceAdjustments: string[];
  classificationReason?: string;
  summary?: string;
  possibleRootCause?: string;
  evidence: string[];
  /** Evidence items the model gave that could not be matched to the collected evidence. */
  removedEvidence: string[];
  recommendedInvestigation: string[];
  suggestedBugTitle?: string;
  suggestedBugDescription?: string;
  /** Rule-based observations and any disagreement with the AI's classification. */
  signals: Signal[];
  conflicts: string[];
  visualInspection: 'performed' | 'unavailable: text-only model (page state from accessibility snapshot)' | 'no screenshot';
  advisoryNote: string;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  durationMs: number;
  attempts: CallAttempt[];
  cached: boolean;
  evidenceChars: number;
}

/**
 * Classifies a failed test from collected evidence (§15, §16). The AI is an enhancement:
 * any AI problem yields status "unavailable"/"failed" with a message, never an exception,
 * and never changes the test's own result (§34, §48).
 */
export class FailureAnalyzer {
  private vision: boolean | undefined;

  constructor(private readonly provider: AIProvider, private readonly options: { useCache?: boolean; timeoutMs?: number } = {}) {}

  async analyze(evidence: FailureEvidence): Promise<FailureAnalysis> {
    const started = Date.now();
    const supportsVision = await this.supportsVision();
    const image = supportsVision ? screenshotBase64(evidence.screenshot) : undefined;
    const evidenceText = renderEvidence(evidence, { visionAttached: !!image });
    const base = this.baseResult(evidence, evidenceText.length, image ? 'performed' : evidence.screenshot?.path ? 'unavailable: text-only model (page state from accessibility snapshot)' : 'no screenshot');

    const cacheKey = crypto.createHash('sha256')
      .update([FAILURE_PROMPT_VERSION, this.provider.name, this.provider.model, String(!!image), stableForCache(evidenceText)].join('\n'))
      .digest('hex').slice(0, 32);
    const cached = this.readCache(cacheKey);
    if (cached) return { ...cached, runId: evidence.environment.runId, cached: true };

    const call = await structuredCall<ModelFailureAnalysis>({
      provider: this.provider,
      system: FAILURE_SYSTEM_PROMPT,
      prompt: buildFailurePrompt(evidenceText),
      schema: failureOutputSchema,
      timeoutMs: this.options.timeoutMs ?? config.ai.generationTimeoutMs,
      maxTokens: 900,
      temperature: 0.1,
      images: image ? [image] : undefined,
      label: 'failure',
    });

    if (!call.ok) {
      const offline = ['UNAVAILABLE', 'MODEL_NOT_FOUND', 'TIMEOUT'].includes(call.failureCode);
      return {
        ...base,
        status: offline ? 'unavailable' : 'failed',
        message: offline
          ? `AI analysis unavailable - ${call.failureCode === 'UNAVAILABLE' ? 'AI provider is offline' : call.failureReason}.`
          : `AI analysis failed: ${call.failureReason}`,
        attempts: call.attempts,
        durationMs: Date.now() - started,
      };
    }

    const result = applyGuards({ ...base, attempts: call.attempts, durationMs: Date.now() - started }, call.data, evidenceText, evidence.signals);
    this.writeCache(cacheKey, result);
    logger.info('ai:failure:analyzed', { test: evidence.test.title, classification: result.classification, confidence: result.confidence, conflicts: result.conflicts.length, durationMs: result.durationMs });
    return result;
  }

  /** Used when the provider is known to be down: every failure gets the fallback message immediately. */
  unavailable(evidence: FailureEvidence, message: string): FailureAnalysis {
    return { ...this.baseResult(evidence, 0, 'no screenshot'), status: 'unavailable', message: `AI analysis unavailable - ${message}` };
  }

  private baseResult(evidence: FailureEvidence, evidenceChars: number, visualInspection: FailureAnalysis['visualInspection']): FailureAnalysis {
    const t = evidence.test;
    return {
      status: 'failed',
      test: { key: t.key, title: t.title, titlePath: t.titlePath, file: t.file, line: t.line, project: t.project, error: t.error.message.slice(0, 500) },
      runId: evidence.environment.runId,
      confidenceAdjustments: [],
      evidence: [],
      removedEvidence: [],
      recommendedInvestigation: [],
      signals: evidence.signals,
      conflicts: [],
      visualInspection,
      advisoryNote: ADVISORY_NOTE,
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: FAILURE_PROMPT_VERSION,
      createdAt: new Date().toISOString(),
      durationMs: 0,
      attempts: [],
      cached: false,
      evidenceChars,
    };
  }

  private async supportsVision(): Promise<boolean> {
    if (this.vision === undefined) {
      try { this.vision = (await this.provider.healthCheck()).supportsVision; } catch { this.vision = false; }
    }
    return this.vision;
  }

  private readCache(key: string): FailureAnalysis | undefined {
    if (this.options.useCache === false) return undefined;
    const file = path.join(CACHE_DIR, `${key}.json`);
    try { return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as FailureAnalysis) : undefined; } catch { return undefined; }
  }

  private writeCache(key: string, result: FailureAnalysis): void {
    if (this.options.useCache === false) return;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(result, null, 2));
    } catch { /* caching is best-effort */ }
  }
}

/** Timings change on every run; removing them lets a repeated identical failure hit the cache. */
export function stableForCache(evidenceText: string): string {
  return evidenceText.replace(/Duration: \d+ ms/g, '').replace(/\(\d+ ms\)/g, '').replace(/durationMs=\d+/g, '');
}

/** Guardrails: grounded evidence only, hedged wording, conflict check against strong signals, calibrated confidence. */
export function applyGuards(base: FailureAnalysis, ai: ModelFailureAnalysis, evidenceText: string, signals: Signal[]): FailureAnalysis {
  const evidence = ai.evidence.filter((e) => isGrounded(e, evidenceText));
  const removedEvidence = ai.evidence.filter((e) => !evidence.includes(e));
  const conflicts = signals
    .filter((s) => s.strength === 'strong' && s.suggests && s.suggests !== ai.classification)
    .map((s) => `Rule-based observation "${s.observation}" usually indicates ${s.suggests}; the AI chose ${ai.classification}.`);
  const { confidence, adjustments } = calibrateConfidence({
    modelConfidence: ai.confidence, classification: ai.classification, groundedEvidence: evidence.length, conflicts: conflicts.length,
  });

  return {
    ...base,
    status: 'analyzed',
    classification: ai.classification,
    confidence,
    confidenceLabel: `AI confidence estimate: ${pct(confidence)}`,
    modelConfidence: ai.confidence,
    confidenceAdjustments: adjustments,
    classificationReason: ai.classificationReason.trim(),
    summary: ensureHedged(ai.summary.trim(), 'Likely:'),
    possibleRootCause: ensureHedged(ai.possibleRootCause.trim()),
    evidence,
    removedEvidence,
    recommendedInvestigation: ai.recommendedInvestigation,
    suggestedBugTitle: ai.suggestedBugTitle.trim(),
    suggestedBugDescription: ai.suggestedBugDescription.trim(),
    conflicts,
  };
}
