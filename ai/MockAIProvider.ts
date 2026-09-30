import type { AIHealth } from './AIProvider';
import { AIProviderError } from './AIProvider';
import { BaseAIProvider, type PreparedRequest, type ProviderSettings, type RawCompletion } from './BaseAIProvider';

export type MockResponder = (request: PreparedRequest) => string | Error;

/**
 * Deterministic provider for testing code that uses AI without a model (AI_PROVIDER=mock).
 * It goes through the same BaseAIProvider safety path, so redaction and truncation are exercised.
 * It never pretends to be a real model: health reports provider "mock".
 */
export class MockAIProvider extends BaseAIProvider {
  readonly name = 'mock';
  /** Every prepared request, after redaction and truncation, for assertions. */
  readonly requests: PreparedRequest[] = [];

  constructor(settings: ProviderSettings, private responder: MockResponder = defaultResponder) {
    super(settings);
  }

  respondWith(responder: MockResponder): void {
    this.responder = responder;
  }

  protected async complete(request: PreparedRequest): Promise<RawCompletion> {
    this.requests.push(request);
    const out = this.responder(request);
    if (out instanceof Error) throw out;
    return { text: out, truncatedOutput: false };
  }

  async healthCheck(): Promise<AIHealth> {
    return { provider: this.name, model: this.model, available: true, modelAvailable: true, supportsVision: false, message: 'Mock provider (no real model)' };
  }
}

function defaultResponder(request: PreparedRequest): string {
  if (request.json) return JSON.stringify({ status: 'ok', echo: request.prompt.slice(0, 50) });
  return `mock response to: ${request.prompt.slice(0, 50)}`;
}

export const mockErrors = {
  unavailable: () => new AIProviderError('UNAVAILABLE', 'Mock: provider offline'),
  timeout: () => new AIProviderError('TIMEOUT', 'Mock: timed out'),
};
