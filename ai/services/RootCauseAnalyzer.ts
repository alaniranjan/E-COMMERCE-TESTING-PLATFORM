import type { AIProvider } from '../AIProvider';
import { buildRootCausePrompt, ROOT_CAUSE_PROMPT_VERSION, ROOT_CAUSE_SYSTEM_PROMPT, rootCauseOutputSchema } from '../prompts/rootCausePrompt';
import { ensureHedged, isGrounded, MAX_CONFIDENCE, pct } from './analysisGuards';
import { structuredCall, type CallAttempt } from './structuredCall';
import { renderEvidence } from '../../analyzer/EvidenceBuilder';
import type { FailureEvidence } from '../../analyzer/types';
import { config } from '../../utils/config';

export interface PossibleCause {
  cause: string;
  evidence: string[];
  confidence: number;
  confidenceLabel: string;
}

export interface RootCauseAnalysis {
  status: 'analyzed' | 'unavailable' | 'failed';
  message?: string;
  testKey: string;
  possibleCauses: PossibleCause[];
  recommendedChecks: string[];
  advisoryNote: string;
  model: string;
  promptVersion: string;
  durationMs: number;
  attempts: CallAttempt[];
}

/**
 * Separate root-cause service (§18): up to three ranked possible causes with their own evidence
 * and confidence, plus checks to confirm them. Run on demand (it costs another model call).
 */
export class RootCauseAnalyzer {
  constructor(private readonly provider: AIProvider, private readonly options: { timeoutMs?: number } = {}) {}

  async analyze(evidence: FailureEvidence): Promise<RootCauseAnalysis> {
    const started = Date.now();
    const evidenceText = renderEvidence(evidence, { visionAttached: false });
    const base = {
      testKey: evidence.test.key, possibleCauses: [], recommendedChecks: [],
      advisoryNote: 'Possible causes are hypotheses for a human to confirm, not findings.',
      model: this.provider.model, promptVersion: ROOT_CAUSE_PROMPT_VERSION,
    };

    const call = await structuredCall<{ possibleCauses: { cause: string; evidence: string[]; confidence: number }[]; recommendedChecks: string[] }>({
      provider: this.provider,
      system: ROOT_CAUSE_SYSTEM_PROMPT,
      prompt: buildRootCausePrompt(evidenceText),
      schema: rootCauseOutputSchema,
      timeoutMs: this.options.timeoutMs ?? config.ai.generationTimeoutMs,
      maxTokens: 700,
      temperature: 0.1,
      label: 'rootcause',
    });
    if (!call.ok) {
      const offline = ['UNAVAILABLE', 'MODEL_NOT_FOUND', 'TIMEOUT'].includes(call.failureCode);
      return { ...base, status: offline ? 'unavailable' : 'failed', message: call.failureReason, durationMs: Date.now() - started, attempts: call.attempts };
    }

    const possibleCauses = call.data.possibleCauses
      .map((c) => {
        const grounded = c.evidence.filter((e) => isGrounded(e, evidenceText));
        // Same rules as the failure analyzer: cap overall, and lower when no evidence item holds up.
        const confidence = Math.round(Math.min(c.confidence, MAX_CONFIDENCE, grounded.length ? 1 : 0.3) * 100) / 100;
        return { cause: ensureHedged(c.cause.trim(), 'Possibly:'), evidence: grounded, confidence, confidenceLabel: `AI confidence estimate: ${pct(confidence)}` };
      })
      .sort((a, b) => b.confidence - a.confidence);

    return { ...base, status: 'analyzed', possibleCauses, recommendedChecks: call.data.recommendedChecks, durationMs: Date.now() - started, attempts: call.attempts };
  }
}
