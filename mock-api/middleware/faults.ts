import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

/**
 * Controlled fault injection for demonstrating failures (e.g. an endpoint returning 500).
 * Faults are registered per scope and only affect requests sending the same X-Fault-Scope
 * header, so a test's fault never leaks into other tests running in parallel.
 */
export const FaultSpec = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  path: z.string().startsWith('/api/'),
  status: z.number().int().min(100).max(599).optional(),
  delayMs: z.number().int().min(0).max(30_000).optional(),
  body: z.unknown().optional(),
  times: z.number().int().min(1).optional(),
});
export type FaultSpec = z.infer<typeof FaultSpec>;

const faults = new Map<string, FaultSpec[]>();

export function addFault(scope: string, fault: FaultSpec): void {
  faults.set(scope, [...(faults.get(scope) ?? []), fault]);
}

export function clearFaults(scope?: string): void {
  if (scope) faults.delete(scope);
  else faults.clear();
}

export async function applyFaults(req: Request, res: Response, next: NextFunction): Promise<void> {
  const scope = req.header('x-fault-scope');
  const list = scope ? faults.get(scope) : undefined;
  // Mounted under /api, so rebuild the full path to match specs like "/api/products".
  const fullPath = req.baseUrl + req.path;
  const index = list?.findIndex((f) => fullPath === f.path && (!f.method || f.method === req.method)) ?? -1;
  if (!list || index === -1) return next();

  const fault = list[index];
  if (fault.times !== undefined && --fault.times <= 0) list.splice(index, 1);
  if (fault.delayMs) await new Promise((r) => setTimeout(r, fault.delayMs));
  if (!fault.status) return next();

  res.setHeader('X-Injected-Fault', 'true');
  res.status(fault.status).json(fault.body ?? {
    error: { code: 'INJECTED_FAULT', message: `Injected ${fault.status} for ${req.method} ${fullPath}` },
  });
}
