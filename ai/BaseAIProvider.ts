import type { AIHealth, AIJSONResponse, AIProvider, AIRequestOptions, AIResponse } from './AIProvider';
import { AIProviderError } from './AIProvider';
import { redactSecrets, truncateMiddle } from './security/redact';
import { logger } from '../utils/logger';

export interface ProviderSettings {
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  maxPromptChars: number;
  /** Exact values (passwords from .env etc.) that must never reach a model. */
  knownSecrets: string[];
}

export interface PreparedRequest extends Required<Pick<AIRequestOptions, 'temperature' | 'maxTokens' | 'timeoutMs'>> {
  prompt: string;
  system?: string;
  json?: boolean | Record<string, unknown>;
  images?: string[];
}

export interface RawCompletion {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  truncatedOutput: boolean;
}

/**
 * Safety every provider inherits (§29, §30): secret redaction and prompt-size limits are applied
 * here, before any provider code runs, so a new provider cannot forget them.
 * Only sizes and timings are logged, never prompt or response content.
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract readonly name: string;

  constructor(protected readonly settings: ProviderSettings) {}

  get model(): string {
    return this.settings.model;
  }

  protected abstract complete(request: PreparedRequest): Promise<RawCompletion>;
  abstract healthCheck(): Promise<AIHealth>;

  async generate(prompt: string, options: AIRequestOptions = {}): Promise<AIResponse> {
    const secrets = this.settings.knownSecrets;
    const user = redactSecrets(prompt, secrets);
    const system = options.system ? redactSecrets(options.system, secrets) : undefined;
    const sized = truncateMiddle(user.text, this.settings.maxPromptChars);
    const redactions = user.redactions + (system?.redactions ?? 0);

    const request: PreparedRequest = {
      prompt: sized.text,
      system: system?.text,
      json: options.json,
      images: options.images,
      temperature: options.temperature ?? this.settings.temperature,
      maxTokens: options.maxTokens ?? this.settings.maxTokens,
      timeoutMs: options.timeoutMs ?? this.settings.timeoutMs,
    };

    const started = Date.now();
    try {
      const raw = await this.complete(request);
      const response: AIResponse = {
        ...raw,
        provider: this.name,
        model: this.model,
        durationMs: Date.now() - started,
        promptTruncated: sized.truncated,
        redactions,
      };
      logger.info('ai:generate', {
        provider: this.name, model: this.model, durationMs: response.durationMs,
        promptChars: request.prompt.length, responseChars: raw.text.length,
        promptTokens: raw.promptTokens, completionTokens: raw.completionTokens,
        redactions, promptTruncated: sized.truncated, truncatedOutput: raw.truncatedOutput,
      });
      return response;
    } catch (err) {
      const code = err instanceof AIProviderError ? err.code : 'PROVIDER_ERROR';
      logger.warn('ai:generate:failed', { provider: this.name, model: this.model, code, error: (err as Error).message, durationMs: Date.now() - started });
      throw err;
    }
  }

  /**
   * Requests JSON and parses it strictly. Tolerant extraction and correction retries are the
   * parser's job (Phase 6); here invalid JSON is reported as INVALID_RESPONSE with the raw text.
   */
  async generateJSON<T = unknown>(prompt: string, options: Omit<AIRequestOptions, 'json'> & { schema?: Record<string, unknown> } = {}): Promise<AIJSONResponse<T>> {
    const { schema, ...rest } = options;
    const response = await this.generate(prompt, { ...rest, json: schema ?? true });
    try {
      return { data: JSON.parse(response.text) as T, response };
    } catch {
      throw new AIProviderError('INVALID_RESPONSE', `${this.name} returned text that is not valid JSON`, {
        provider: this.name, model: this.model, raw: response.text.slice(0, 2000),
      });
    }
  }
}
