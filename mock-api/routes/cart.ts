import { Router, type Response } from 'express';
import { z } from 'zod';
import { ApiError, notFound } from '../errors';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { cartView, store } from '../store';
import { parse } from '../validate';

export const cartRouter = Router();
cartRouter.use(requireAuth);

export const MAX_QTY_PER_ITEM = 10;

const Quantity = z.number().int('quantity must be an integer')
  .min(1, 'quantity must be at least 1').max(MAX_QTY_PER_ITEM, `quantity must be at most ${MAX_QTY_PER_ITEM}`);
const AddItem = z.object({ productId: z.number().int().positive(), quantity: Quantity.default(1) }).strict();
const UpdateItem = z.object({ quantity: Quantity }).strict();
const ProductIdParam = z.object({ productId: z.coerce.number().int().positive() });

function checkStock(productId: number, quantity: number): void {
  const product = store.products.get(productId);
  if (!product) throw notFound(`Product ${productId}`);
  if (quantity > MAX_QTY_PER_ITEM) {
    throw new ApiError(400, 'VALIDATION_ERROR', `quantity must be at most ${MAX_QTY_PER_ITEM}`, [{ field: 'quantity', message: `cart would hold ${quantity}` }]);
  }
  if (quantity > product.stock) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} of product ${productId} in stock`);
}

const userId = (req: AuthedRequest) => req.user!.id;
const sendCart = (req: AuthedRequest, res: Response, status = 200) => res.status(status).json(cartView(userId(req)));

cartRouter.get('/', (req: AuthedRequest, res) => sendCart(req, res));

cartRouter.post('/items', (req: AuthedRequest, res) => {
  const { productId, quantity } = parse(AddItem, req.body);
  const cart = store.cart(userId(req));
  const line = cart.find((l) => l.productId === productId);
  checkStock(productId, (line?.quantity ?? 0) + quantity);
  if (line) line.quantity += quantity;
  else cart.push({ productId, quantity });
  sendCart(req, res, 201);
});

cartRouter.patch('/items/:productId', (req: AuthedRequest, res) => {
  const { productId } = parse(ProductIdParam, req.params);
  const { quantity } = parse(UpdateItem, req.body);
  const line = store.cart(userId(req)).find((l) => l.productId === productId);
  if (!line) throw notFound(`Cart item for product ${productId}`);
  checkStock(productId, quantity);
  line.quantity = quantity;
  sendCart(req, res);
});

cartRouter.delete('/items/:productId', (req: AuthedRequest, res) => {
  const { productId } = parse(ProductIdParam, req.params);
  const cart = store.cart(userId(req));
  const index = cart.findIndex((l) => l.productId === productId);
  if (index === -1) throw notFound(`Cart item for product ${productId}`);
  cart.splice(index, 1);
  sendCart(req, res);
});

cartRouter.delete('/', (req: AuthedRequest, res) => {
  store.carts.set(userId(req), []);
  res.status(204).end();
});
