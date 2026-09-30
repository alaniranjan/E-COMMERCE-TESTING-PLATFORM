/**
 * The only way the platform talks to an LLM. Services and tests depend on this interface,
 * never on a concrete provider, so the model/provider can change through configuration.
 */
export interface AIRequestOptions {
  /** System instructions (role, rules). The prompt argument carries the task and data. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Ask the model for JSON. `true` = any JSON object; an object = a JSON Schema the provider
   * enforces where supported (Ollama structured outputs). Output is still validated by callers.
   */
  json?: boolean | Record<string, unknown>;
  /** Base64 images for vision-capable models. Providers reject this if the model cannot see images. */
  images?: string[];
}

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** True when the model stopped because it hit maxTokens (output may be cut off). */
  truncatedOutput: boolean;
  /** Safety measures applied to the prompt before sending. */
  promptTruncated: boolean;
  redactions: number;
}

export interface AIJSONResponse<T> {
  data: T;
  response: AIResponse;
}

export interface AIHealth {
  provider: string;
  model: string;
  /** Provider endpoint reachable. */
  available: boolean;
  /** Configured model installed/usable. */
  modelAvailable: boolean;
  /** Model can accept images (used to decide whether screenshot analysis is possible). */
  supportsVision: boolean;
  version?: string;
  message: string;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generate(prompt: string, options?: AIRequestOptions): Promise<AIResponse>;
  generateJSON<T = unknown>(prompt: string, options?: Omit<AIRequestOptions, 'json'> & { schema?: Record<string, unknown> }): Promise<AIJSONResponse<T>>;
  healthCheck(): Promise<AIHealth>;
}

export type AIErrorCode =
  | 'UNAVAILABLE' // provider not reachable (e.g. Ollama not running)
  | 'MODEL_NOT_FOUND' // model not pulled/installed
  | 'TIMEOUT'
  | 'INVALID_RESPONSE' // response missing, malformed, or not valid JSON when JSON was requested
  | 'UNSUPPORTED' // e.g. images sent to a text-only model
  | 'CONFIG' // unknown provider or bad configuration
  | 'PROVIDER_ERROR'; // any other provider-side error

/** Typed error so callers can degrade gracefully ("AI analysis unavailable") instead of failing tests. */
export class AIProviderError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly details: { provider?: string; model?: string; status?: number; raw?: string } = {},
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
