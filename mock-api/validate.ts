import type { z } from 'zod';
import { validationError } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}
