import { test, expect } from '../../fixtures/apiFixtures';
import { errorSchema, loginSchema } from '../../api/schemas';
import { config } from '../../utils/config';
import { uniqueUsername } from '../../utils/unique';

test.describe('API: authentication', { tag: ['@api', '@regression'] }, () => {
  test('Valid login returns a bearer token', { tag: '@smoke' }, async ({ authApi }) => {
    const res = await authApi.login(config.apiUsername, config.apiPassword);

    expect(res).toHaveStatus(200);
    expect(res.body).toMatchSchema(loginSchema);
    expect(res.body.user.username).toBe(config.apiUsername);
    expect(res).toRespondWithin();
  });

  test('Invalid password is rejected with 401', { tag: '@negative' }, async ({ authApi }) => {
    const res = await authApi.login(config.apiUsername, 'wrong-password');

    expect(res).toHaveStatus(401);
    expect(res.body).toMatchSchema(errorSchema);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  test('Unknown user gets the same 401 as a wrong password', { tag: '@negative' }, async ({ authApi }) => {
    const unknown = await authApi.login(uniqueUsername('nobody'), 'whatever-password');
    const wrongPassword = await authApi.login(config.apiUsername, 'wrong-password');

    // Identical responses so the API does not reveal which usernames exist.
    expect(unknown).toHaveStatus(401);
    expect(unknown.body).toEqual(wrongPassword.body);
  });

  test('Locked user is refused with 403', { tag: '@negative' }, async ({ authApi }) => {
    const res = await authApi.login('locked_api_user', config.apiPassword);

    expect(res).toHaveStatus(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  const missingFields: Array<[string, Record<string, string>, string]> = [
    ['missing username', { password: 'x' }, 'username'],
    ['missing password', { username: 'api_user' }, 'password'],
    ['empty body', {}, 'username'],
  ];
  for (const [label, body, field] of missingFields) {
    test(`Login with ${label} returns 400`, { tag: '@negative' }, async ({ api }) => {
      const res = await api.post('/api/auth/login', body, { auth: false });

      expect(res).toHaveStatus(400);
      expect(res.body).toMatchSchema(errorSchema);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: expect.arrayContaining([expect.objectContaining({ field })]) } });
    });
  }

  test('Malformed JSON body returns 400', { tag: '@negative' }, async ({ api }) => {
    const res = await api.post('/api/auth/login', '{"username": ', { auth: false, headers: { 'Content-Type': 'application/json' } });

    expect(res).toHaveStatus(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' } });
  });

  test('Protected endpoint without a token returns 401', { tag: '@negative' }, async ({ api }) => {
    const res = await api.get('/api/cart');

    expect(res).toHaveStatus(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  test('Protected endpoint with an invalid token returns 401', { tag: '@negative' }, async ({ api }) => {
    api.setToken('not-a-real-token-0000000000000000');

    const res = await api.get('/api/cart');

    expect(res).toHaveStatus(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
  });

  test('Registering a taken username returns 409 (duplicate request)', { tag: '@negative' }, async ({ authApi }) => {
    const username = uniqueUsername();
    const first = await authApi.register(username, 'Password-123');
    const second = await authApi.register(username, 'Password-123');

    expect(first).toHaveStatus(201);
    expect(second).toHaveStatus(409);
    expect(second.body).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  test('Tokens and passwords are masked in the request log', async ({ api, authApi }) => {
    await authApi.loginAs(config.apiUsername, config.apiPassword);
    await api.get('/api/cart');

    const log = JSON.stringify(api.exchanges);
    expect(log).not.toContain(config.apiPassword);
    expect(log).toContain('[REDACTED]');
    expect(log).not.toMatch(/Bearer [0-9a-f]{20,}/);
  });
});
