import type { AnySchema } from 'ajv';
import { test as base, expect as baseExpect } from './testFixtures';
import { ApiClient, type ApiResponse } from '../api/ApiClient';
import { AuthApi } from '../api/AuthApi';
import { CartApi } from '../api/CartApi';
import { OrderApi } from '../api/OrderApi';
import { ProductApi } from '../api/ProductApi';
import { validateSchema } from '../utils/schemaValidator';
import type { ProductInput } from '../api/types';
import { config } from '../utils/config';
import { loadTestData } from '../utils/testData';
import { uniqueSku, uniqueUsername } from '../utils/unique';
import type { ApiData } from '../test-data/types';

export interface FaultSpec {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  status?: number;
  delayMs?: number;
  times?: number;
  /** Custom response body for the injected status. */
  body?: unknown;
}

interface ApiFixtures {
  /** Unauthenticated client; each test gets its own context and fault scope. */
  api: ApiClient;
  authApi: AuthApi;
  productApi: ProductApi;
  cartApi: CartApi;
  orderApi: OrderApi;
  /** A freshly registered user logged in on `api`, so carts and orders never collide across parallel tests. */
  apiUser: { username: string; password: string };
  /** Creates additional independent clients (e.g. a second user). */
  newApiClient: () => Promise<ApiClient>;
  /** Inject controlled faults (status codes, delays) for this test only. */
  faults: { inject: (spec: FaultSpec) => Promise<void> };
  apiData: ApiData;
  /** Builds a valid, unique product payload. */
  buildProduct: (overrides?: Partial<ProductInput>) => ProductInput;
}

export const test = base.extend<ApiFixtures>({
  api: async ({ playwright }, use, testInfo) => {
    const scope = `${testInfo.testId}-r${testInfo.retry}`;
    const context = await playwright.request.newContext({
      baseURL: config.apiBaseUrl,
      extraHTTPHeaders: { 'X-Fault-Scope': scope },
    });
    const client = new ApiClient(context);
    await use(client);

    if (testInfo.status !== testInfo.expectedStatus && client.exchanges.length) {
      await testInfo.attach('api-exchanges.json', {
        body: JSON.stringify(client.exchanges, null, 2),
        contentType: 'application/json',
      });
    }
    await context.delete('/__test/faults').catch(() => undefined);
    await context.dispose();
  },

  authApi: async ({ api }, use) => use(new AuthApi(api)),
  productApi: async ({ api }, use) => use(new ProductApi(api)),
  cartApi: async ({ api }, use) => use(new CartApi(api)),
  orderApi: async ({ api }, use) => use(new OrderApi(api)),

  apiUser: async ({ authApi }, use) => {
    const user = { username: uniqueUsername(), password: `Pw-${uniqueUsername()}` };
    const registered = await authApi.register(user.username, user.password);
    if (registered.status !== 201) throw new Error(`Test user registration failed: ${registered.status}`);
    await authApi.loginAs(user.username, user.password);
    await use(user);
  },

  newApiClient: async ({ playwright }, use) => {
    const contexts: Array<{ dispose: () => Promise<void> }> = [];
    await use(async () => {
      const context = await playwright.request.newContext({ baseURL: config.apiBaseUrl });
      contexts.push(context);
      return new ApiClient(context);
    });
    await Promise.all(contexts.map((c) => c.dispose()));
  },

  faults: async ({ api }, use) => {
    await use({
      inject: async (spec) => {
        const res = await api.post('/__test/faults', spec, { auth: false });
        if (res.status !== 201) throw new Error(`Fault injection failed: ${res.status} ${JSON.stringify(res.body)}`);
      },
    });
  },

  apiData: async ({}, use) => use(loadTestData<ApiData>('api-data')),

  buildProduct: async ({ apiData }, use) => {
    await use((overrides = {}) => ({ ...apiData.newProduct, sku: uniqueSku(), ...overrides }));
  },
});

/** API-specific assertions: JSON-schema conformance and response time. */
export const expect = baseExpect.extend({
  toMatchSchema(received: unknown, schema: AnySchema) {
    const { valid, errors } = validateSchema(schema, received);
    const name = (schema as { $id?: string }).$id ?? 'schema';
    return {
      pass: valid,
      name: 'toMatchSchema',
      message: () => valid
        ? `Expected body not to match the "${name}" schema`
        : `Body does not match the "${name}" schema:\n  - ${errors.join('\n  - ')}\n\nReceived: ${JSON.stringify(received, null, 2).slice(0, 1500)}`,
    };
  },

  toRespondWithin(received: ApiResponse, maxMs: number = config.apiResponseTimeMs) {
    const pass = received.durationMs <= maxMs;
    return {
      pass,
      name: 'toRespondWithin',
      message: () => `Expected response time ${pass ? '>' : '<='} ${maxMs} ms, got ${received.durationMs} ms`,
    };
  },

  /** Asserts status and, on mismatch, shows the response body so the failure explains itself. */
  toHaveStatus(received: ApiResponse, expected: number) {
    const pass = received.status === expected;
    return {
      pass,
      name: 'toHaveStatus',
      message: () => `Expected HTTP ${expected}, got ${received.status}\nResponse body: ${JSON.stringify(received.body, null, 2).slice(0, 1500)}`,
    };
  },
});
