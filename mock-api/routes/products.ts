import { Router } from 'express';
import { z } from 'zod';
import { ApiError, notFound } from '../errors';
import { requireAuth } from '../middleware/auth';
import { store, type Product } from '../store';
import { parse } from '../validate';

export const productsRouter = Router();

const CATEGORIES = ['bags', 'apparel', 'accessories', 'toys'] as const;

// Field rules without defaults, so PATCH never injects values the client did not send.
const productFields = {
  sku: z.string().regex(/^[A-Z0-9-]{3,20}$/, 'sku must be 3-20 chars: uppercase letters, digits, hyphen'),
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be at most 100 characters'),
  description: z.string().max(500),
  price: z.number().min(0.01, 'price must be at least 0.01').max(10_000, 'price must be at most 10000')
    .refine((n) => Math.round(n * 100) === n * 100, 'price must have at most 2 decimal places'),
  category: z.enum(CATEGORIES),
  stock: z.number().int().min(0).max(100_000),
};

const ProductBody = z.object({ ...productFields, description: productFields.description.default('') }).strict();

const ProductPatch = z.object(productFields).partial().strict()
  .refine((b) => Object.keys(b).length > 0, 'body must contain at least one field');

const ListQuery = z.object({
  category: z.enum(CATEGORIES).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'name_asc', 'name_desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const IdParam = z.object({ id: z.coerce.number().int().positive('id must be a positive integer') });

function findProduct(rawId: unknown): Product {
  const { id } = parse(IdParam, { id: rawId });
  const product = store.products.get(id);
  if (!product) throw notFound(`Product ${id}`);
  return product;
}

productsRouter.get('/', (req, res) => {
  const q = parse(ListQuery, req.query);
  let items = [...store.products.values()];
  if (q.category) items = items.filter((p) => p.category === q.category);
  if (q.minPrice !== undefined) items = items.filter((p) => p.price >= q.minPrice!);
  if (q.maxPrice !== undefined) items = items.filter((p) => p.price <= q.maxPrice!);
  const sorters: Record<string, (a: Product, b: Product) => number> = {
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    name_asc: (a, b) => a.name.localeCompare(b.name),
    name_desc: (a, b) => b.name.localeCompare(a.name),
  };
  if (q.sort) items.sort(sorters[q.sort]);
  const start = (q.page - 1) * q.pageSize;
  res.json({ items: items.slice(start, start + q.pageSize), total: items.length, page: q.page, pageSize: q.pageSize });
});

productsRouter.get('/:id', (req, res) => {
  res.json(findProduct(req.params.id));
});

productsRouter.post('/', requireAuth, (req, res) => {
  const body = parse(ProductBody, req.body);
  if (store.skuTaken(body.sku)) throw new ApiError(409, 'CONFLICT', `SKU "${body.sku}" already exists`);
  const product = store.createProduct(body);
  res.status(201).location(`/api/products/${product.id}`).json(product);
});

productsRouter.put('/:id', requireAuth, (req, res) => {
  const product = findProduct(req.params.id);
  const body = parse(ProductBody, req.body);
  if (store.skuTaken(body.sku, product.id)) throw new ApiError(409, 'CONFLICT', `SKU "${body.sku}" already exists`);
  Object.assign(product, body, { updatedAt: new Date().toISOString() });
  res.json(product);
});

productsRouter.patch('/:id', requireAuth, (req, res) => {
  const product = findProduct(req.params.id);
  const body = parse(ProductPatch, req.body);
  if (body.sku && store.skuTaken(body.sku, product.id)) throw new ApiError(409, 'CONFLICT', `SKU "${body.sku}" already exists`);
  Object.assign(product, body, { updatedAt: new Date().toISOString() });
  res.json(product);
});

productsRouter.delete('/:id', requireAuth, (req, res) => {
  const product = findProduct(req.params.id);
  store.products.delete(product.id);
  for (const cart of store.carts.values()) {
    const i = cart.findIndex((l) => l.productId === product.id);
    if (i !== -1) cart.splice(i, 1);
  }
  res.status(204).end();
});
