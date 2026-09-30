import { test, expect } from '../../fixtures/apiFixtures';
import { cartSchema } from '../../api/schemas';
import { AuthApi } from '../../api/AuthApi';
import { CartApi } from '../../api/CartApi';
import { uniqueUsername } from '../../utils/unique';

test.describe('API: cart', { tag: ['@api', '@regression'] }, () => {
  test.beforeEach(async ({ apiUser }) => {
    expect(apiUser.username).toBeTruthy();
  });

  test('A new user starts with an empty cart', async ({ cartApi }) => {
    const res = await cartApi.get();

    expect(res).toHaveStatus(200);
    expect(res.body).toMatchSchema(cartSchema);
    expect(res.body).toEqual({ items: [], itemCount: 0, subtotal: 0 });
  });

  test('Add an item', { tag: '@smoke' }, async ({ cartApi, apiData }) => {
    const { id, name, price } = apiData.seededProducts.backpack;

    const res = await cartApi.addItem(id, 2);

    expect(res).toHaveStatus(201);
    expect(res.body).toMatchSchema(cartSchema);
    expect(res.body.items).toEqual([{ productId: id, name, unitPrice: price, quantity: 2, lineTotal: price! * 2 }]);
    expect(res).toRespondWithin();
  });

  test('Quantity defaults to 1 when omitted', async ({ cartApi, apiData }) => {
    const res = await cartApi.addItem(apiData.seededProducts.bikeLight.id);

    expect(res.body.items[0].quantity).toBe(1);
  });

  test('Adding the same product again increases its quantity', async ({ cartApi, apiData }) => {
    const { id } = apiData.seededProducts.backpack;

    await cartApi.addItem(id, 1);
    const res = await cartApi.addItem(id, 2);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(3);
  });

  test('Quantity boundaries: 1 and 10 accepted, 0 and 11 rejected', { tag: '@boundary' }, async ({ cartApi, apiData }) => {
    const { min, max, belowMin, aboveMax } = apiData.boundaries.quantity;
    const { backpack, bikeLight } = apiData.seededProducts;

    expect(await cartApi.addItem(backpack.id, min)).toHaveStatus(201);
    expect(await cartApi.addItem(bikeLight.id, max)).toHaveStatus(201);
    expect(await cartApi.addItem(backpack.id, belowMin)).toHaveStatus(400);
    expect(await cartApi.addItem(apiData.seededProducts.fleeceJacket.id, aboveMax)).toHaveStatus(400);
  });

  test('Cumulative quantity above the per-item limit is rejected', { tag: '@boundary' }, async ({ cartApi, apiData }) => {
    const { id } = apiData.seededProducts.backpack;
    await cartApi.addItem(id, 10);

    const res = await cartApi.addItem(id, 1);

    expect(res).toHaveStatus(400);
    expect((await cartApi.get()).body.items[0].quantity).toBe(10);
  });

  test('Quantity above available stock returns 409', { tag: '@negative' }, async ({ cartApi, apiData }) => {
    const { id, stock } = apiData.seededProducts.lowStock;

    const res = await cartApi.addItem(id, stock! + 1);

    expect(res).toHaveStatus(409);
    expect(res.body).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });
  });

  test('Adding a non-existent product returns 404', { tag: '@negative' }, async ({ cartApi }) => {
    const res = await cartApi.addItem(999_999, 1);

    expect(res).toHaveStatus(404);
  });

  test('Missing productId returns 400', { tag: '@negative' }, async ({ api }) => {
    const res = await api.post('/api/cart/items', { quantity: 1 });

    expect(res).toHaveStatus(400);
    expect(res.body).toMatchObject({ error: { details: [expect.objectContaining({ field: 'productId' })] } });
  });

  test('PATCH changes an item quantity', async ({ cartApi, apiData }) => {
    const { id, price } = apiData.seededProducts.bikeLight;
    await cartApi.addItem(id, 1);

    const res = await cartApi.updateItem(id, 4);

    expect(res).toHaveStatus(200);
    expect(res.body.items[0]).toMatchObject({ quantity: 4, lineTotal: Math.round(price! * 4 * 100) / 100 });
  });

  test('PATCH for a product not in the cart returns 404', { tag: '@negative' }, async ({ cartApi, apiData }) => {
    const res = await cartApi.updateItem(apiData.seededProducts.backpack.id, 2);

    expect(res).toHaveStatus(404);
  });

  test('DELETE removes one item; DELETE /cart clears it', async ({ cartApi, apiData }) => {
    const { backpack, bikeLight } = apiData.seededProducts;
    await cartApi.addItem(backpack.id, 1);
    await cartApi.addItem(bikeLight.id, 1);

    const afterRemove = await cartApi.removeItem(backpack.id);
    expect(afterRemove).toHaveStatus(200);
    expect(afterRemove.body.items.map((i) => i.productId)).toEqual([bikeLight.id]);

    expect(await cartApi.clear()).toHaveStatus(204);
    expect((await cartApi.get()).body.itemCount).toBe(0);
  });

  test('Subtotal and item count are calculated correctly', async ({ cartApi, apiData }) => {
    const { backpack, bikeLight, fleeceJacket } = apiData.seededProducts;
    await cartApi.addItem(backpack.id, 2);
    await cartApi.addItem(bikeLight.id, 3);
    await cartApi.addItem(fleeceJacket.id, 1);

    const { body } = await cartApi.get();

    const expected = Math.round((backpack.price! * 2 + bikeLight.price! * 3 + fleeceJacket.price!) * 100) / 100;
    expect(body.subtotal).toBe(expected);
    expect(body.itemCount).toBe(6);
    expect(body.items.every((i) => i.lineTotal === Math.round(i.unitPrice * i.quantity * 100) / 100)).toBe(true);
  });

  test('Carts are isolated between users', async ({ cartApi, newApiClient, apiData }) => {
    await cartApi.addItem(apiData.seededProducts.backpack.id, 1);

    const otherClient = await newApiClient();
    const otherAuth = new AuthApi(otherClient);
    const other = { username: uniqueUsername(), password: 'Password-123' };
    await otherAuth.register(other.username, other.password);
    await otherAuth.loginAs(other.username, other.password);

    const otherCart = await new CartApi(otherClient).get();
    expect(otherCart.body.itemCount).toBe(0);
  });
});
