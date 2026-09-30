import path from 'path';
import dotenv from 'dotenv';
import { environments, isEnvironmentName, EnvironmentName } from '../config/environments';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

export class ConfigError extends Error {}

function readString(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`Missing required environment variable: ${name}. See .env.example.`);
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new ConfigError(`Environment variable ${name} must be a number, got "${raw}".`);
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
}

function readEnvironment(): EnvironmentName {
  const env = readString('TEST_ENV', 'qa');
  if (!isEnvironmentName(env)) {
    throw new ConfigError(`TEST_ENV must be one of ${Object.keys(environments).join(', ')}, got "${env}".`);
  }
  return env;
}

const testEnv = readEnvironment();

export const config = {
  testEnv,
  baseUrl: readString('BASE_URL', environments[testEnv].baseUrl).replace(/\/+$/, ''),
  headless: readBoolean('HEADLESS', true),
  actionTimeout: readNumber('ACTION_TIMEOUT', 10_000),
  navigationTimeout: readNumber('NAVIGATION_TIMEOUT', 30_000),
  apiBaseUrl: readString('API_BASE_URL', 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  apiResponseTimeMs: readNumber('API_RESPONSE_TIME_MS', 1000),
  get apiUsername(): string {
    return readString('API_USERNAME');
  },
  get apiPassword(): string {
    return readString('API_PASSWORD');
  },
  ai: {
    provider: readString('AI_PROVIDER', 'ollama'),
    model: readString('AI_MODEL', 'qwen2.5:7b'),
    ollamaBaseUrl: readString('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    /** CPU-only inference is slow; keep this generous. */
    timeoutMs: readNumber('AI_TIMEOUT', 120_000),
    maxTokens: readNumber('AI_MAX_TOKENS', 1024),
    temperature: readNumber('AI_TEMPERATURE', 0.2),
    /** Long outputs (e.g. generating several test cases) on CPU need minutes, not seconds. */
    generationTimeoutMs: readNumber('AI_GENERATION_TIMEOUT', 600_000),
    /** How long Ollama keeps the model loaded after a request (avoids ~50 s reloads). */
    keepAlive: readString('AI_KEEP_ALIVE', '30m'),
    /** Short description of the application under test given to the test-case generator. */
    appContextFile: readString('AI_APP_CONTEXT_FILE', 'ai/context/saucedemo.md'),
    /** Prompts longer than this are truncated (middle removed) before sending. */
    maxPromptChars: readNumber('AI_MAX_PROMPT_CHARS', 12_000),
  },
  /** Read lazily so a missing password only fails tests that need it. */
  get testUserPassword(): string {
    return readString('TEST_USER_PASSWORD');
  },
} as const;
