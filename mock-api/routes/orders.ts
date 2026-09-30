import { Router } from 'express';
import { z } from 'zod';
import { ApiError, notFound } from '../errors';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { cartView, money, store, TAX_RATE, type Order } from '../store';
import { parse } from '../validate';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const PlaceOrder = z.object({
  shipping: z.object({
    firstName: z.string().trim().min(1, 'firstName is required'),
    lastName: z.string().trim().min(1, 'lastName is required'),
    postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/, 'postalCode must be 3-10 letters, digits, spaces or hyphens'),
  }).strict(),
}).strict();

const UpdateOrder = z.object({ status: z.literal('cancelled') }).strict();

function ownOrder(req: AuthedRequest): Order {
  const order = store.orders.get(String(req.params.id));
  // Another user's order is reported as not found so ids cannot be probed.
  if (!order || order.userId !== req.user!.id) throw notFound(`Order ${req.params.id}`);
  return order;
}

ordersRouter.post('/', (req: AuthedRequest, res) => {
  const user = req.user!;
  const key = req.header('idempotency-key');
  if (key) {
    const existing = store.idempotency.get(`${user.id}:${key}`);
    if (existing) {
      res.setHeader('Idempotent-Replayed', 'true');
      return res.status(200).json(store.orders.get(existing));
    }
  }

  const { shipping } = parse(PlaceOrder, req.body);
  const cart = cartView(user.id);
  if (cart.items.length === 0) throw new ApiError(400, 'EMPTY_CART', 'Cannot place an order with an empty cart');
  for (const item of cart.items) {
    const product = store.products.get(item.productId)!;
    if (item.quantity > product.stock) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} of ${product.name} in stock`);
  }

  for (const item of cart.items) store.products.get(item.productId)!.stock -= item.quantity;
  const tax = money(cart.subtotal * TAX_RATE);
  const now = new Date().toISOString();
  const order: Order = {
    id: store.nextOrderId(),
    userId: user.id,
    status: 'placed',
    items: cart.items,
    subtotal: cart.subtotal,
    tax,
    total: money(cart.subtotal + tax),
    shipping,
    createdAt: now,
    updatedAt: now,
  };
  store.orders.set(order.id, order);
  store.carts.set(user.id, []);
  if (key) store.idempotency.set(`${user.id}:${key}`, order.id);
  res.status(201).location(`/api/orders/${order.id}`).json(order);
});

ordersRouter.get('/', (req: AuthedRequest, res) => {
  const items = [...store.orders.values()].filter((o) => o.userId === req.user!.id);
  res.json({ items, total: items.length });
});

ordersRouter.get('/:id', (req: AuthedRequest, res) => {
  res.json(ownOrder(req));
});

ordersRouter.patch('/:id', (req: AuthedRequest, res) => {
  const order = ownOrder(req);
  parse(UpdateOrder, req.body);
  if (order.status === 'cancelled') throw new ApiError(409, 'CONFLICT', `Order ${order.id} is already cancelled`);
  for (const item of order.items) {
    const product = store.products.get(item.productId);
    if (product) product.stock += item.quantity;
  }
  order.status = 'cancelled';
  order.updatedAt = new Date().toISOString();
  res.json(order);
});
