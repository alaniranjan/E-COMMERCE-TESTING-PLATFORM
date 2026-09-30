import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../errors';
import { store, TOKEN_TTL_MS } from '../store';
import { parse } from '../validate';

export const authRouter = Router();

const Credentials = z.object({
  username: z.string().min(1, 'username is required'),
  password: z.string().min(1, 'password is required'),
});

const Registration = z.object({
  username: z.string().regex(/^[a-z0-9_]{3,40}$/, 'username must be 3-40 chars: lowercase letters, digits, underscore'),
  password: z.string().min(8, 'password must be at least 8 characters').max(64),
});

authRouter.post('/register', (req, res) => {
  const { username, password } = parse(Registration, req.body);
  if (store.users.has(username)) throw new ApiError(409, 'CONFLICT', `Username "${username}" is already taken`);
  const user = store.createUser(username, password);
  res.status(201).json({ id: user.id, username: user.username });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = parse(Credentials, req.body);
  const user = store.users.get(username);
  if (!user || !store.checkPassword(user, password)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid username or password');
  }
  if (user.locked) throw new ApiError(403, 'FORBIDDEN', 'User account is locked');
  const session = store.createSession(user.id);
  res.json({ token: session.token, tokenType: 'Bearer', expiresIn: TOKEN_TTL_MS / 1000, user: { id: user.id, username } });
});
