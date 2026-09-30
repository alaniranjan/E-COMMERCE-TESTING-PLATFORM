import type { Meta, Page, Run, RunDetails, Summary } from './types.ts';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  } catch {
    throw new ApiError('Cannot reach the dashboard server. Is it running?', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body);
  return body as T;
}

export const api = {
  summary: () => request<Summary>('/api/dashboard/summary'),
  meta: () => request<Meta>('/api/dashboard/meta'),
  runs: (params: { page?: number; pageSize?: number; suite?: string; status?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    return request<Page<Run>>(`/api/runs?${qs}`);
  },
  run: (id: string) => request<RunDetails>(`/api/runs/${encodeURIComponent(id)}`),
  startRun: (suite: string, browser: string) =>
    request<{ runId: string }>('/api/runs', { method: 'POST', body: JSON.stringify({ suite, browser }) }),
};
