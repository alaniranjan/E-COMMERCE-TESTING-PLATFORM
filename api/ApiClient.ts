import type { APIRequestContext } from '@playwright/test';
import { logger, maskSecrets } from '../utils/logger';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  data?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Send the stored bearer token (default true). */
  auth?: boolean;
}

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: T;
  /** Client-side round-trip time, used for response-time assertions. */
  durationMs: number;
}

/** One request/response pair, secrets masked. Attached to failed tests and used by AI analysis later. */
export interface ApiExchange {
  timestamp: string;
  method: HttpMethod;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
  durationMs: number;
}

const MAX_LOGGED_BODY_CHARS = 4_000;

/**
 * Thin wrapper over Playwright's APIRequestContext: bearer-token handling, timing,
 * JSON parsing and an exchange log. It never throws on HTTP status; tests assert status explicitly.
 */
export class ApiClient {
  private token: string | null = null;
  readonly exchanges: ApiExchange[] = [];

  constructor(private readonly context: APIRequestContext) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  get hasToken(): boolean {
    return this.token !== null;
  }

  async request<T = unknown>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.auth !== false && this.token && !headers.Authorization) headers.Authorization = `Bearer ${this.token}`;
    const params = options.params
      ? Object.fromEntries(Object.entries(options.params).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>
      : undefined;

    const started = performance.now();
    const response = await this.context.fetch(path, { method, headers, params, data: options.data, failOnStatusCode: false });
    const text = await response.text();
    const durationMs = Math.round(performance.now() - started);

    let body: unknown = text;
    if (text && (response.headers()['content-type'] ?? '').includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text; // Keep the raw text; the test's schema assertion will report it.
      }
    } else if (!text) {
      body = null;
    }

    const exchange: ApiExchange = {
      timestamp: new Date().toISOString(),
      method,
      url: response.url(),
      requestHeaders: maskSecrets(headers) as Record<string, string>,
      requestBody: maskSecrets(options.data),
      status: response.status(),
      responseBody: truncate(maskSecrets(body)),
      durationMs,
    };
    this.exchanges.push(exchange);
    logger.debug('api:request', { method, url: exchange.url, httpStatus: exchange.status, durationMs });

    return { status: response.status(), ok: response.ok(), headers: response.headers(), body: body as T, durationMs };
  }

  get<T = unknown>(path: string, options?: RequestOptions) { return this.request<T>('GET', path, options); }
  post<T = unknown>(path: string, data?: unknown, options?: RequestOptions) { return this.request<T>('POST', path, { ...options, data }); }
  put<T = unknown>(path: string, data?: unknown, options?: RequestOptions) { return this.request<T>('PUT', path, { ...options, data }); }
  patch<T = unknown>(path: string, data?: unknown, options?: RequestOptions) { return this.request<T>('PATCH', path, { ...options, data }); }
  delete<T = unknown>(path: string, options?: RequestOptions) { return this.request<T>('DELETE', path, options); }
}

function truncate(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (!json || json.length <= MAX_LOGGED_BODY_CHARS) return value;
  return `${json.slice(0, MAX_LOGGED_BODY_CHARS)}… [truncated ${json.length - MAX_LOGGED_BODY_CHARS} chars]`;
}
