import type { AnySchema } from 'ajv';
import type { AIProvider, AIResponse } from '../AIProvider';
import { AIProviderError } from '../AIProvider';
import { parseAIJson, type ExtractionMethod } from '../parsers/AIResponseParser';
import { buildCorrectionPrompt } from '../prompts/correctionPrompt';
import { logger } from '../../utils/logger';

export interface CallAttempt {
  attempt: number;
  kind: 'initial' | 'correction';
  ok: boolean;
  durationMs: number;
  extraction?: ExtractionMethod;
  errors: string[];
  outputCutOff: boolean;
  outputTokens?: number;
  /** First part of the raw model output, kept for debugging rejected answers. */
  rawPreview: string;
}

export type StructuredCallResult<T> =
  | { ok: true; data: T; method: ExtractionMethod; attempts: CallAttempt[] }
  | { ok: false; failureCode: string; failureReason: string; attempts: CallAttempt[] };

export interface StructuredCallOptions<T> {
  provider: AIProvider;
  system: string;
  prompt: string;
  /** Validated with Ajv; also sent to the provider as a structured-output constraint (without $id). */
  schema: AnySchema & { $id?: string };
  semanticCheck?: (data: T) => string[];
  maxAttempts?: number;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  images?: string[];
  /** Label for logs, e.g. "testcases" or "failure". */
  label: string;
}

/**
 * One structured AI call: request JSON, extract and validate it, and on invalid output retry
 * with a correction prompt listing the problems. Provider errors (offline, timeout, missing
 * model) end the call immediately; re-prompting cannot fix them. Never throws for AI problems.
 */
export async function structuredCall<T>(o: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
  const attempts: CallAttempt[] = [];
  const maxAttempts = o.maxAttempts ?? 2;
  const { $id: _id, ...constraint } = o.schema as Record<string, unknown>;
  let prompt = o.prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: AIResponse;
    try {
      response = await o.provider.generate(prompt, {
        system: o.system, json: constraint, timeoutMs: o.timeoutMs, maxTokens: o.maxTokens,
        temperature: o.temperature, images: attempt === 1 ? o.images : undefined,
      });
    } catch (err) {
      return {
        ok: false,
        failureCode: err instanceof AIProviderError ? err.code : 'PROVIDER_ERROR',
        failureReason: `AI provider error: ${(err as Error).message}`,
        attempts,
      };
    }

    const parsed = parseAIJson<T>(response.text, o.schema, o.semanticCheck);
    attempts.push({
      attempt, kind: attempt === 1 ? 'initial' : 'correction', ok: parsed.ok, durationMs: response.durationMs,
      extraction: parsed.method, errors: parsed.ok ? [] : parsed.errors, outputCutOff: response.truncatedOutput,
      outputTokens: response.completionTokens, rawPreview: response.text.slice(0, 1_500),
    });
    if (parsed.ok) return { ok: true, data: parsed.data, method: parsed.method, attempts };

    logger.warn(`ai:${o.label}:rejected`, { attempt, stage: parsed.stage, errors: parsed.errors.slice(0, 5) });
    if (attempt < maxAttempts) prompt = buildCorrectionPrompt(o.prompt, response.text, parsed.errors, response.truncatedOutput);
    else {
      return {
        ok: false,
        failureCode: 'INVALID_OUTPUT',
        failureReason: `Model output was still invalid after ${maxAttempts} attempts: ${parsed.errors.slice(0, 3).join('; ')}`,
        attempts,
      };
    }
  }
  throw new Error('unreachable');
}
