import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors';
import { store, type User } from '../store';

export interface AuthedRequest extends Request {
  user?: User;
}

/** Requires "Authorization: Bearer <token>" from POST /api/auth/login. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return next(new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token'));
  }
  const session = store.sessions.get(match[1]);
  if (!session || session.expiresAt < Date.now()) {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    return next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
  req.user = [...store.users.values()].find((u) => u.id === session.userId);
  next();
}
