import { test, expect } from '../../fixtures/apiFixtures';
import { orderSchema } from '../../api/schemas';
import { AuthApi } from '../../api/AuthApi';
import { OrderApi } from '../../api/OrderApi';
import { uniqueSuffix, uniqueUsername } from '../../utils/unique';

const round = (n: number) => Math.round(n * 100) / 100;

test.describe('API: orders', { tag: ['@api', '@regression'] }, () => {
  test.beforeEach(async ({ apiUser, cartApi, apiData }) => {
    expect(apiUser.username).toBeTruthy();
    await cartApi.addItem(apiData.seededProducts.backpack.id, 2);
    await cartApi.addItem(apiData.seededProducts.bikeLight.id, 1);
  });

  test('Place an order from the cart', { tag: '@smoke' }, async ({ orderApi, cartApi, apiData }) => {
    const { backpack, bikeLight } = apiData.seededProducts;
    const subtotal = round(backpack.price! * 2 + bikeLight.price!);
    const tax = round(subtotal * apiData.taxRate);

    const res = await orderApi.place(apiData.shipping.valid);

    expect(res).toHaveStatus(201);
    expect(res.body).toMatchSchema(orderSchema);
    expect(res.body).toMatchObject({ status: 'placed', subtotal, tax, total: round(subtotal + tax), shipping: apiData.shipping.valid });
    expect(res.headers.location).toBe(`/api/orders/${res.body.id}`);
    expect(res).toRespondWithin();
    expect((await cartApi.get()).body.itemCount).toBe(0);
  });

  test('Order reduces product stock', async ({ orderApi, productApi, apiData }) => {
    const { id } = apiData.seededProducts.bikeLight;
    const before = (await productApi.get(id)).body.stock;

    await orderApi.place(apiData.shipping.valid);

    // Other parallel tests also order this product, so stock can only have dropped by at least our quantity.
    expect((await productApi.get(id)).body.stock).toBeLessThanOrEqual(before - 1);
  });

  test('GET /orders/:id and /orders return the placed order', async ({ orderApi, apiData }) => {
    const placed = (await orderApi.place(apiData.shipping.valid)).body;

    const one = await orderApi.get(placed.id);
    const list = await orderApi.list();

    expect(one).toHaveStatus(200);
    expect(one.body).toEqual(placed);
    expect(list.body.items.map((o) => o.id)).toEqual([placed.id]);
  });

  test('Placing an order with an empty cart returns 400', { tag: '@negative' }, async ({ orderApi, cartApi, apiData }) => {
    await cartApi.clear();

    const res = await orderApi.place(apiData.shipping.valid);

    expect(res).toHaveStatus(400);
    expect(res.body).toMatchObject({ error: { code: 'EMPTY_CART' } });
  });

  const invalidShipping: Array<[string, string]> = [
    ['missingFirstName', 'shipping.firstName'],
    ['missingLastName', 'shipping.lastName'],
    ['missingPostalCode', 'shipping.postalCode'],
    ['whitespaceFirstName', 'shipping.firstName'],
    ['invalidPostalCode', 'shipping.postalCode'],
  ];
  for (const [key, field] of invalidShipping) {
    test(`Shipping validation: ${key} returns 400`, { tag: '@negative' }, async ({ orderApi, cartApi, apiData }) => {
      const res = await orderApi.place(apiData.invalidShipping[key]);

      expect(res).toHaveStatus(400);
      expect(res.body).toMatchObject({ error: { details: [expect.objectContaining({ field })] } });
      // A rejected order must not empty the cart.
      expect((await cartApi.get()).body.itemCount).toBe(3);
    });
  }

  test('Missing shipping object returns 400', { tag: '@negative' }, async ({ api }) => {
    const res = await api.post('/api/orders', {});

    expect(res).toHaveStatus(400);
  });

  test('Duplicate request with the same Idempotency-Key creates one order', async ({ orderApi, apiData }) => {
    const idempotencyKey = `order-${uniqueSuffix()}`;

    const first = await orderApi.place(apiData.shipping.valid, { idempotencyKey });
    const retry = await orderApi.place(apiData.shipping.valid, { idempotencyKey });

    expect(first).toHaveStatus(201);
    expect(retry).toHaveStatus(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect((await orderApi.list()).body.total).toBe(1);
  });

  test('Cancel an order; cancelling again returns 409', async ({ orderApi, apiData }) => {
    const placed = (await orderApi.place(apiData.shipping.valid)).body;

    const cancelled = await orderApi.cancel(placed.id);
    const again = await orderApi.cancel(placed.id);

    expect(cancelled).toHaveStatus(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(again).toHaveStatus(409);
  });

  test("Another user's order is not visible (404)", { tag: '@negative' }, async ({ orderApi, newApiClient, apiData }) => {
    const placed = (await orderApi.place(apiData.shipping.valid)).body;

    const otherClient = await newApiClient();
    const other = { username: uniqueUsername(), password: 'Password-123' };
    await new AuthApi(otherClient).register(other.username, other.password);
    await new AuthApi(otherClient).loginAs(other.username, other.password);

    const res = await new OrderApi(otherClient).get(placed.id);
    expect(res).toHaveStatus(404);
  });

  test('Unknown order id returns 404', { tag: '@negative' }, async ({ orderApi }) => {
    expect(await orderApi.get('ORD-999999')).toHaveStatus(404);
  });
});
