import type { AIProvider } from './AIProvider';
import { AIProviderError } from './AIProvider';
import type { ProviderSettings } from './BaseAIProvider';
import { MockAIProvider } from './MockAIProvider';
import { OllamaProvider } from './OllamaProvider';
import { config } from '../utils/config';

/** Secrets from configuration that must never reach a model, even if they appear in logs or errors. */
function knownSecrets(): string[] {
  const values: string[] = [];
  for (const read of [() => config.testUserPassword, () => config.apiPassword]) {
    try { values.push(read()); } catch { /* not configured */ }
  }
  return values;
}

export function providerSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    model: config.ai.model,
    timeoutMs: config.ai.timeoutMs,
    maxTokens: config.ai.maxTokens,
    temperature: config.ai.temperature,
    maxPromptChars: config.ai.maxPromptChars,
    knownSecrets: knownSecrets(),
    ...overrides,
  };
}

/**
 * Builds the configured provider (AI_PROVIDER). Adding a provider (e.g. OpenAI, Hugging Face)
 * means: extend BaseAIProvider, implement complete() and healthCheck(), and add a case here.
 */
export function createAIProvider(name: string = config.ai.provider, overrides: Partial<ProviderSettings> = {}): AIProvider {
  const settings = providerSettings(overrides);
  switch (name) {
    case 'ollama':
      return new OllamaProvider(settings, config.ai.ollamaBaseUrl, config.ai.keepAlive);
    case 'mock':
      return new MockAIProvider(settings);
    default:
      throw new AIProviderError('CONFIG', `Unknown AI_PROVIDER "${name}". Supported: ollama, mock.`);
  }
}
