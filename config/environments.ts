/**
 * Per-environment defaults. Values from .env always win over these,
 * so switching the application under test only needs BASE_URL in .env.
 */
export type EnvironmentName = 'qa' | 'staging' | 'local';

export interface EnvironmentDefaults {
  baseUrl: string;
}

export const environments: Record<EnvironmentName, EnvironmentDefaults> = {
  qa: { baseUrl: 'https://www.saucedemo.com' },
  staging: { baseUrl: 'https://www.saucedemo.com' },
  local: { baseUrl: 'http://localhost:3000' },
};

export function isEnvironmentName(value: string): value is EnvironmentName {
  return value in environments;
}
