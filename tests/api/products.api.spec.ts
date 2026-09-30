import { test, expect } from '../../fixtures/apiFixtures';
import { errorSchema, productListSchema, productSchema } from '../../api/schemas';

test.describe('API: products', { tag: ['@api', '@regression'] }, () => {
  test.describe('read (public)', () => {
    test('GET /products returns the catalog', { tag: '@smoke' }, async ({ productApi, apiData }) => {
      const res = await productApi.list();

      expect(res).toHaveStatus(200);
      expect(res.body).toMatchSchema(productListSchema);
      expect(res).toRespondWithin();
      const names = res.body.items.map((p) => p.name);
      for (const seeded of Object.values(apiData.seededProducts)) expect(names).toContain(seeded.name);
    });

    test('GET /products/:id returns one product', async ({ productApi, apiData }) => {
      const { id, name, price } = apiData.seededProducts.backpack;

      const res = await productApi.get(id);

      expect(res).toHaveStatus(200);
      expect(res.body).toMatchSchema(productSchema);
      expect(res.body).toMatchObject({ id, name, price });
    });

    test('Filter by category and price range', async ({ productApi }) => {
      const res = await productApi.list({ category: 'apparel', minPrice: 10, maxPrice: 20 });

      expect(res).toHaveStatus(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const p of res.body.items) {
        expect(p.category).toBe('apparel');
        expect(p.price).toBeGreaterThanOrEqual(10);
        expect(p.price).toBeLessThanOrEqual(20);
      }
    });

    test('Sort by price descending', async ({ productApi }) => {
      const res = await productApi.list({ sort: 'price_desc', pageSize: 50 });

      const prices = res.body.items.map((p) => p.price);
      expect(prices).toEqual([...prices].sort((a, b) => b - a));
    });

    test('Page size boundaries: 1 and 50 accepted, 0 and 51 rejected', { tag: '@boundary' }, async ({ productApi, apiData }) => {
      const { min, max, belowMin, aboveMax } = apiData.boundaries.pageSize;

      const [atMin, atMax, below, above] = await Promise.all(
        [min, max, belowMin, aboveMax].map((pageSize) => productApi.list({ pageSize })),
      );

      expect(atMin).toHaveStatus(200);
      expect(atMin.body.items).toHaveLength(1);
      expect(atMax).toHaveStatus(200);
      expect(below).toHaveStatus(400);
      expect(above).toHaveStatus(400);
      expect(above.body).toMatchObject({ error: { details: [expect.objectContaining({ field: 'pageSize' })] } });
    });

    test('Invalid query parameter value returns 400', { tag: '@negative' }, async ({ productApi }) => {
      const res = await productApi.list({ category: 'weapons' as never });

      expect(res).toHaveStatus(400);
      expect(res.body).toMatchSchema(errorSchema);
    });

    test('Non-existent product returns 404', { tag: '@negative' }, async ({ productApi }) => {
      const res = await productApi.get(999_999);

      expect(res).toHaveStatus(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    test('Non-numeric product id returns 400', { tag: '@negative' }, async ({ productApi }) => {
      const res = await productApi.get('abc');

      expect(res).toHaveStatus(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });
  });

  test.describe('write (authenticated)', () => {
    test('POST creates a product (201, Location header, schema)', async ({ apiUser, productApi, buildProduct }) => {
      const input = buildProduct();

      const res = await productApi.create(input);

      expect(res).toHaveStatus(201);
      expect(res.body).toMatchSchema(productSchema);
      expect(res.body).toMatchObject(input);
      expect(res.headers.location).toBe(`/api/products/${res.body.id}`);

      const fetched = await productApi.get(res.body.id);
      expect(fetched.body).toEqual(res.body);
    });

    test('POST without a token returns 401', { tag: '@negative' }, async ({ productApi, buildProduct }) => {
      const res = await productApi.create(buildProduct());

      expect(res).toHaveStatus(401);
    });

    const requiredFields = ['sku', 'name', 'price', 'category', 'stock'] as const;
    for (const field of requiredFields) {
      test(`POST without required field "${field}" returns 400`, { tag: '@negative' }, async ({ apiUser, productApi, buildProduct }) => {
        const { [field]: _omitted, ...input } = buildProduct();

        const res = await productApi.create(input);

        expect(res).toHaveStatus(400);
        expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: expect.arrayContaining([expect.objectContaining({ field })]) } });
      });
    }

    test('POST rejects wrong types and unknown fields', { tag: '@negative' }, async ({ apiUser, productApi, buildProduct }) => {
      const res = await productApi.create({ ...buildProduct(), price: '12.50', isAdmin: true });

      expect(res).toHaveStatus(400);
      const fields = (res.body as unknown as { error: { details: { field: string }[] } }).error.details.map((d) => d.field);
      expect(fields).toContain('price');
      expect(fields).toContain('(body)'); // unrecognized key "isAdmin"
    });

    test('Price boundaries: 0.01 and 10000 accepted, 0 and 10000.01 rejected', { tag: '@boundary' }, async ({ apiUser, productApi, buildProduct, apiData }) => {
      const { min, max, belowMin, aboveMax, tooManyDecimals } = apiData.boundaries.price;

      const results = await Promise.all(
        [min, max, belowMin, aboveMax, tooManyDecimals].map((price) => productApi.create(buildProduct({ price }))),
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 400, 400, 400]);
    });

    test('Name length boundary: 100 accepted, 101 rejected', { tag: '@boundary' }, async ({ apiUser, productApi, buildProduct, apiData }) => {
      const max = apiData.boundaries.nameMaxLength;

      const atMax = await productApi.create(buildProduct({ name: 'N'.repeat(max) }));
      const overMax = await productApi.create(buildProduct({ name: 'N'.repeat(max + 1) }));

      expect(atMax).toHaveStatus(201);
      expect(overMax).toHaveStatus(400);
    });

    test('Duplicate POST with the same SKU returns 409', { tag: '@negative' }, async ({ apiUser, productApi, buildProduct }) => {
      const input = buildProduct();

      const first = await productApi.create(input);
      const duplicate = await productApi.create(input);

      expect(first).toHaveStatus(201);
      expect(duplicate).toHaveStatus(409);
      expect(duplicate.body).toMatchObject({ error: { code: 'CONFLICT' } });
    });

    test('PUT replaces a product', async ({ apiUser, productApi, buildProduct }) => {
      const created = (await productApi.create(buildProduct())).body;
      const replacement = buildProduct({ name: 'Replaced Name', price: 99.99, category: 'toys', stock: 1 });

      const res = await productApi.replace(created.id, replacement);

      expect(res).toHaveStatus(200);
      expect(res.body).toMatchSchema(productSchema);
      expect(res.body).toMatchObject({ id: created.id, ...replacement });
      expect(Date.parse(res.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
    });

    test('PUT with a missing field returns 400 and leaves the product unchanged', { tag: '@negative' }, async ({ apiUser, productApi, buildProduct }) => {
      const created = (await productApi.create(buildProduct())).body;
      const { stock: _omitted, ...incomplete } = buildProduct({ name: 'Should Not Apply' });

      const res = await productApi.replace(created.id, incomplete);

      expect(res).toHaveStatus(400);
      expect((await productApi.get(created.id)).body).toEqual(created);
    });

    test('PATCH updates only the given field', async ({ apiUser, productApi, buildProduct }) => {
      const created = (await productApi.create(buildProduct())).body;

      const res = await productApi.update(created.id, { price: 5.25 });

      expect(res).toHaveStatus(200);
      expect(res.body.price).toBe(5.25);
      const { price: _p, updatedAt: _u, ...unchanged } = created;
      expect(res.body).toMatchObject(unchanged);
    });

    test('PATCH with an empty body returns 400', { tag: '@negative' }, async ({ apiUser, productApi, buildProduct }) => {
      const created = (await productApi.create(buildProduct())).body;

      const res = await productApi.update(created.id, {});

      expect(res).toHaveStatus(400);
    });

    test('DELETE removes a product; a second DELETE returns 404', async ({ apiUser, productApi, buildProduct }) => {
      const created = (await productApi.create(buildProduct())).body;

      const deleted = await productApi.remove(created.id);
      const fetched = await productApi.get(created.id);
      const deletedAgain = await productApi.remove(created.id);

      expect(deleted).toHaveStatus(204);
      expect(deleted.body).toBeNull();
      expect(fetched).toHaveStatus(404);
      expect(deletedAgain).toHaveStatus(404);
    });
  });

  test.describe('resilience', () => {
    test('Server error (500) is surfaced with the error body', async ({ productApi, faults }) => {
      await faults.inject({ method: 'GET', path: '/api/products', status: 500, times: 1 });

      const failed = await productApi.list();
      const recovered = await productApi.list();

      expect(failed).toHaveStatus(500);
      expect(failed.headers['x-injected-fault']).toBe('true');
      expect(failed.body).toMatchSchema(errorSchema);
      expect(recovered).toHaveStatus(200);
    });

    test('Response time is measured client-side', async ({ productApi, faults }) => {
      await faults.inject({ method: 'GET', path: '/api/products', delayMs: 300, times: 1 });

      const slow = await productApi.list();
      const normal = await productApi.list();

      expect(slow.durationMs).toBeGreaterThanOrEqual(300);
      expect(slow).not.toRespondWithin(250);
      expect(normal).toRespondWithin();
    });
  });
});
