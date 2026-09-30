import { Agent, fetch, type RequestInit, type Response } from 'undici';
import type { AIHealth } from './AIProvider';
import { AIProviderError } from './AIProvider';
import { BaseAIProvider, type PreparedRequest, type ProviderSettings, type RawCompletion } from './BaseAIProvider';

interface OllamaChatResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Node's built-in fetch gives up after 300 s without headers or between body chunks. A slow CPU
 * model can pause longer than that, so those limits are switched off and each request's own
 * AbortSignal timeout (AI_TIMEOUT / AI_GENERATION_TIMEOUT) is the only limit.
 */
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/** Local open-source models through Ollama's REST API (https://github.com/ollama/ollama/blob/main/docs/api.md). */
export class OllamaProvider extends BaseAIProvider {
  readonly name = 'ollama';
  private visionSupport: boolean | undefined;

  constructor(settings: ProviderSettings, private readonly baseUrl: string, private readonly keepAlive?: string) {
    super(settings);
  }

  protected async complete(request: PreparedRequest): Promise<RawCompletion> {
    if (request.images?.length && !(await this.supportsVision())) {
      throw new AIProviderError('UNSUPPORTED', `Model ${this.model} does not accept images`, { provider: this.name, model: this.model });
    }

    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.prompt, ...(request.images?.length ? { images: request.images } : {}) },
    ];
    const body = {
      model: this.model,
      messages,
      // Streaming: Ollama sends headers immediately, so long CPU generations are not cut off by
      // fetch's built-in 300 s header timeout. Our own timeoutMs bounds the whole request.
      stream: true,
      ...(this.keepAlive ? { keep_alive: this.keepAlive } : {}),
      ...(request.json ? { format: request.json === true ? 'json' : request.json } : {}),
      options: { temperature: request.temperature, num_predict: request.maxTokens },
    };

    const signal = AbortSignal.timeout(request.timeoutMs);
    const res = await this.send('/api/chat', { method: 'POST', body: JSON.stringify(body) }, signal, request.timeoutMs);
    if (!res.ok) throw await this.httpError(res);

    let text = '';
    let final: OllamaChatResponse | undefined;
    try {
      for await (const chunk of ndjson<OllamaChatResponse>(res)) {
        if (chunk.error) throw new AIProviderError('PROVIDER_ERROR', `Ollama error: ${chunk.error}`, { provider: this.name, model: this.model });
        text += chunk.message?.content ?? '';
        if (chunk.done) final = chunk;
      }
    } catch (err) {
      throw this.mapNetworkError(err, request.timeoutMs);
    }
    if (!final) {
      throw new AIProviderError('INVALID_RESPONSE', 'Ollama stream ended before completion', { provider: this.name, model: this.model, raw: text.slice(0, 500) });
    }
    return {
      text,
      promptTokens: final.prompt_eval_count,
      completionTokens: final.eval_count,
      truncatedOutput: final.done_reason === 'length',
    };
  }

  async healthCheck(): Promise<AIHealth> {
    const base = { provider: this.name, model: this.model, available: false, modelAvailable: false, supportsVision: false };
    let version: string | undefined;
    try {
      version = (await this.fetchJson<{ version: string }>('/api/version', { method: 'GET' }, 5_000)).version;
    } catch (err) {
      return { ...base, message: `Ollama not reachable at ${this.baseUrl}: ${(err as Error).message}` };
    }
    try {
      const tags = await this.fetchJson<{ models: { name: string }[] }>('/api/tags', { method: 'GET' }, 5_000);
      const installed = tags.models.map((m) => m.name);
      if (!installed.some((name) => name === this.model || name === `${this.model}:latest`)) {
        return { ...base, available: true, version, message: `Model "${this.model}" is not pulled. Run: ollama pull ${this.model}. Installed: ${installed.join(', ') || 'none'}` };
      }
      const supportsVision = await this.supportsVision();
      return { ...base, available: true, modelAvailable: true, supportsVision, version, message: `Ollama ${version} ready with ${this.model}${supportsVision ? ' (vision)' : ' (text only)'}` };
    } catch (err) {
      return { ...base, available: true, version, message: `Ollama reachable but model check failed: ${(err as Error).message}` };
    }
  }

  /** Asks Ollama which capabilities the model has; text-only is assumed if it cannot say. */
  private async supportsVision(): Promise<boolean> {
    if (this.visionSupport !== undefined) return this.visionSupport;
    try {
      const show = await this.fetchJson<{ capabilities?: string[] }>('/api/show', { method: 'POST', body: JSON.stringify({ model: this.model }) }, 10_000);
      this.visionSupport = show.capabilities?.includes('vision') ?? false;
    } catch {
      this.visionSupport = false;
    }
    return this.visionSupport;
  }

  private async fetchJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const res = await this.send(path, init, AbortSignal.timeout(timeoutMs), timeoutMs);
    if (!res.ok) throw await this.httpError(res);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AIProviderError('INVALID_RESPONSE', `Ollama returned non-JSON (HTTP ${res.status})`, { provider: this.name, model: this.model, status: res.status, raw: text.slice(0, 500) });
    }
  }

  private async send(path: string, init: RequestInit, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json' }, signal, dispatcher });
    } catch (err) {
      throw this.mapNetworkError(err, timeoutMs);
    }
  }

  private async httpError(res: Response): Promise<AIProviderError> {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body */
    }
    const code = res.status === 404 && /not found/i.test(message) ? 'MODEL_NOT_FOUND' : 'PROVIDER_ERROR';
    return new AIProviderError(code, `Ollama error: ${message}`, { provider: this.name, model: this.model, status: res.status, raw: text.slice(0, 500) });
  }

  /** Distinguishes "took too long" from "not reachable", so callers report the right cause. */
  private mapNetworkError(err: unknown, timeoutMs: number): AIProviderError {
    if (err instanceof AIProviderError) return err;
    const e = err as Error & { cause?: { code?: string } };
    const code = e.cause?.code ?? (e as { code?: string }).code;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return new AIProviderError('TIMEOUT', `Ollama did not finish within ${timeoutMs} ms`, { provider: this.name, model: this.model });
    }
    if (/UND_ERR_(HEADERS|BODY)_TIMEOUT/.test(code ?? '')) {
      return new AIProviderError('TIMEOUT', `Ollama stopped sending data (${code})`, { provider: this.name, model: this.model });
    }
    return new AIProviderError('UNAVAILABLE', `Cannot reach Ollama at ${this.baseUrl} (${code ?? e.message}). Is "ollama serve" running?`, { provider: this.name, model: this.model });
  }
}

/** Parses Ollama's newline-delimited JSON stream. */
async function* ndjson<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield parseLine<T>(line);
    }
  }
  if (buffer.trim()) yield parseLine<T>(buffer.trim());
}

function parseLine<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new AIProviderError('INVALID_RESPONSE', 'Ollama stream contained invalid JSON', { raw: line.slice(0, 500) });
  }
}
