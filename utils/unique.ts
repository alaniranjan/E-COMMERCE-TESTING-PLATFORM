import crypto from 'node:crypto';

/** Collision-safe suffix for data created by parallel tests. */
export function uniqueSuffix(length = 8): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

export function uniqueUsername(prefix = 'qa'): string {
  return `${prefix}_${uniqueSuffix(10)}`;
}

export function uniqueSku(prefix = 'QA'): string {
  return `${prefix}-${uniqueSuffix(8).toUpperCase()}`;
}
