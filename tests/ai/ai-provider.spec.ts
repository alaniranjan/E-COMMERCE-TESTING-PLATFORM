import { test, expect } from '../../fixtures/testFixtures';
import { AIProviderError } from '../../ai/AIProvider';
import { MockAIProvider } from '../../ai/MockAIProvider';
import { OllamaProvider } from '../../ai/OllamaProvider';
import { createAIProvider, providerSettings } from '../../ai/providerFactory';
import { redactSecrets, truncateMiddle } from '../../ai/security/redact';
import { chatReply, FakeOllama } from './support/fakeOllama';

const settings = providerSettings({ model: 'fake-model', timeoutMs: 2_000, knownSecrets: ['s3cr3t-sauce'] });

test.describe('AI layer: secret redaction', { tag: ['@ai', '@regression'] }, () => {
  const cases: Array<[string, string, string]> = [
    ['bearer token', 'Authorization: Bearer abc.def-123456789', 'abc.def-123456789'],
    ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N', 'eyJhbGciOiJIUzI1NiJ9'],
    ['password=value', 'login failed for password=hunter22 user=bob', 'hunter22'],
    ['JSON password field', '{"username":"bob","password":"hunter22"}', 'hunter22'],
    ['api key field', 'api_key: sk-live-9f8e7d6c', 'sk-live-9f8e7d6c'],
    ['known .env secret', 'typed s3cr3t-sauce into the field', 's3cr3t-sauce'],
    ['hex session token', 'session 3f9a1c0b7e2d4a6f8b1c3e5d7f9a0b2c4d6e8f1a', '3f9a1c0b7e2d4a6f8b1c3e5d7f9a0b2c'],
    ['URL credentials', 'GET https://admin:pa55w0rd@internal.example.com/x', 'pa55w0rd'],
    ['email address', 'order for jane.doe@example.com failed', 'jane.doe@example.com'],
    ['card number (Luhn-valid)', 'paid with 4111 1111 1111 1111', '4111 1111 1111 1111'],
  ];
  for (const [label, input, secret] of cases) {
    test(`masks ${label}`, async () => {
      const { text, redactions } = redactSecrets(input, ['s3cr3t-sauce']);
      expect(text).not.toContain(secret);
      expect(text).toContain('[REDACTED');
      expect(redactions).toBeGreaterThan(0);
    });
  }

  test('keeps ordinary test evidence readable', async () => {
    const input = 'Expected: "Thank you for your order!" Received: "Checkout: Overview" at checkout.spec.ts:60 (order 1234567890123)';
    expect(redactSecrets(input).text).toBe(input); // 13-digit order id fails the Luhn check, so it stays
  });

  test('truncation keeps the start and end of long text', async () => {
    const text = `START ${'x'.repeat(5_000)} END`;
    const out = truncateMiddle(text, 1_000);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(1_000);
    expect(out.text.startsWith('START')).toBe(true);
    expect(out.text.endsWith('END')).toBe(true);
    expect(out.text).toContain('[truncated');
  });

  test('every provider receives the redacted, size-limited prompt', async () => {
    const provider = new MockAIProvider({ ...settings, maxPromptChars: 500 });
    const response = await provider.generate(`Bearer abcdefghijklmnop password=hunter22 ${'y'.repeat(2_000)}`, { system: 'use s3cr3t-sauce' });

    const sent = provider.requests[0];
    expect(sent.prompt).not.toContain('hunter22');
    expect(sent.prompt).not.toContain('abcdefghijklmnop');
    expect(sent.system).not.toContain('s3cr3t-sauce');
    expect(sent.prompt.length).toBeLessThanOrEqual(500);
    expect(response).toMatchObject({ promptTruncated: true, redactions: 3 });
  });
});

test.describe('AI layer: OllamaProvider (fake Ollama server)', { tag: ['@ai', '@regression'] }, () => {
  const fake = new FakeOllama();
  let baseUrl: string;
  const provider = () => new OllamaProvider(settings, baseUrl);

  test.beforeAll(async () => { baseUrl = await fake.start(); });
  test.afterAll(async () => { await fake.stop(); });
  test.beforeEach(() => fake.reset());

  test('sends a streaming chat request with model and options', async () => {
    fake.on('/api/chat', () => chatReply('Hello from the model'));

    const res = await provider().generate('Say hello', { system: 'You are a QA assistant', temperature: 0.1, maxTokens: 64 });

    expect(res).toMatchObject({ text: 'Hello from the model', provider: 'ollama', model: 'fake-model', promptTokens: 42, completionTokens: 7, truncatedOutput: false });
    expect(fake.requests[0].body).toEqual({
      model: 'fake-model',
      stream: true,
      messages: [{ role: 'system', content: 'You are a QA assistant' }, { role: 'user', content: 'Say hello' }],
      options: { temperature: 0.1, num_predict: 64 },
    });
  });

  test('generateJSON requests JSON (or a schema) and parses the result', async () => {
    fake.on('/api/chat', () => chatReply('{"classification":"APPLICATION_DEFECT","confidence":0.7}'));
    const schema = { type: 'object', properties: { classification: { type: 'string' } } };

    const { data } = await provider().generateJSON<{ classification: string }>('Classify', { schema });

    expect(data.classification).toBe('APPLICATION_DEFECT');
    expect(fake.requests[0].body.format).toEqual(schema);
  });

  test('invalid JSON from the model is INVALID_RESPONSE with the raw text kept', async () => {
    fake.on('/api/chat', () => chatReply('Sure! Here is the JSON: {classification: maybe'));

    const error = await provider().generateJSON('Classify').catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', details: { raw: expect.stringContaining('Sure! Here is') } });
  });

  test('output cut off at maxTokens is flagged', async () => {
    fake.on('/api/chat', () => chatReply('partial…', { done_reason: 'length' }));

    expect((await provider().generate('Long answer please')).truncatedOutput).toBe(true);
  });

  test('model not pulled is MODEL_NOT_FOUND', async () => {
    fake.on('/api/chat', () => ({ status: 404, body: { error: 'model "fake-model" not found, try pulling it first' } }));

    await expect(provider().generate('hi')).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  });

  test('slow model is TIMEOUT', async () => {
    fake.on('/api/chat', () => ({ ...chatReply('late'), delayMs: 1_000 }));

    await expect(provider().generate('hi', { timeoutMs: 200 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  test('streamed chunks are joined into one answer', async () => {
    const lines = [
      { message: { role: 'assistant', content: '{"a":' }, done: false },
      { message: { role: 'assistant', content: '1}' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 3 },
    ];
    fake.on('/api/chat', () => ({ body: null, raw: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' }));

    const { data, response } = await provider().generateJSON<{ a: number }>('json please');

    expect(data).toEqual({ a: 1 });
    expect(response.completionTokens).toBe(3);
  });

  test('error inside the stream is a PROVIDER_ERROR', async () => {
    fake.on('/api/chat', () => ({ body: null, raw: JSON.stringify({ error: 'model runner crashed' }) + '\n' }));

    await expect(provider().generate('hi')).rejects.toMatchObject({ code: 'PROVIDER_ERROR', message: expect.stringContaining('runner crashed') });
  });

  test('Ollama not running is UNAVAILABLE', async () => {
    const offline = new OllamaProvider(settings, 'http://127.0.0.1:9'); // nothing listens on port 9

    await expect(offline.generate('hi')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await offline.healthCheck()).available).toBe(false);
  });

  test('health check reports a missing model with the pull command', async () => {
    fake.on('/api/version', () => ({ body: { version: '9.9.9' } }))
      .on('/api/tags', () => ({ body: { models: [{ name: 'llama3.2:1b' }] } }));

    const health = await provider().healthCheck();

    expect(health).toMatchObject({ available: true, modelAvailable: false, version: '9.9.9' });
    expect(health.message).toContain('ollama pull fake-model');
  });

  test('health check reports vision capability from the model', async () => {
    fake.on('/api/version', () => ({ body: { version: '9.9.9' } }))
      .on('/api/tags', () => ({ body: { models: [{ name: 'fake-model' }] } }))
      .on('/api/show', () => ({ body: { capabilities: ['completion', 'vision'] } }));

    expect(await provider().healthCheck()).toMatchObject({ available: true, modelAvailable: true, supportsVision: true });
  });

  test('images sent to a text-only model are refused, not silently dropped', async () => {
    fake.on('/api/show', () => ({ body: { capabilities: ['completion'] } }))
      .on('/api/chat', () => chatReply('I see a checkout page'));

    await expect(provider().generate('Describe this screenshot', { images: ['iVBORw0KGgo='] })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(fake.requests.some((r) => r.path === '/api/chat')).toBe(false);
  });

  test('unknown AI_PROVIDER is a CONFIG error', async () => {
    expect(() => createAIProvider('gpt-magic')).toThrow(expect.objectContaining({ code: 'CONFIG' }));
  });
});

test.describe('AI layer: live model', { tag: ['@ai', '@ai-live'] }, () => {
  // Real inference on CPU can take a while.
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(async () => {
    const health = await createAIProvider().healthCheck();
    test.skip(!health.modelAvailable, `Live AI tests skipped: ${health.message}`);
  });

  test('answers a simple prompt', async () => {
    const res = await createAIProvider().generate('Reply with exactly one word: pong', { maxTokens: 10, temperature: 0 });

    expect(res.text.toLowerCase()).toContain('pong');
    expect(res.completionTokens).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'ai-timing', description: `${res.model}: ${res.durationMs} ms, ${res.completionTokens} output tokens` });
  });

  test('returns valid structured JSON when asked', async () => {
    const schema = {
      type: 'object',
      required: ['status', 'severity'],
      properties: { status: { enum: ['passed', 'failed'] }, severity: { enum: ['low', 'medium', 'high'] } },
    };

    const { data, response } = await createAIProvider().generateJSON<{ status: string; severity: string }>(
      'A checkout test failed because the Place Order button did nothing. Report status and severity.',
      { schema, maxTokens: 60, temperature: 0 },
    );

    expect(data.status).toBe('failed');
    expect(['low', 'medium', 'high']).toContain(data.severity);
    test.info().annotations.push({ type: 'ai-timing', description: `${response.model}: ${response.durationMs} ms` });
  });
});
