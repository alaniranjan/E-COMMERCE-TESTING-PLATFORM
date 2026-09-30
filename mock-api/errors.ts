import type { Response } from 'express';
import type { ZodError } from 'zod';

/** Every error response has the same shape: { error: { code, message, details? } } */
export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'EMPTY_CART' | 'INSUFFICIENT_STOCK' | 'INTERNAL_ERROR' | 'INJECTED_FAULT';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
}

export function validationError(error: ZodError): ApiError {
  const details = error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
  return new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
}

export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);
