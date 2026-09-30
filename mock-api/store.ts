import crypto from 'node:crypto';

export const TAX_RATE = 0.08;
export const TOKEN_TTL_MS = 60 * 60 * 1000;

export type Category = 'bags' | 'apparel' | 'accessories' | 'toys';

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  category: Category;
  stock: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  locked: boolean;
}

export interface CartLine {
  productId: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: number;
  status: 'placed' | 'cancelled';
  items: { productId: number; name: string; unitPrice: number; quantity: number; lineTotal: number }[];
  subtotal: number;
  tax: number;
  total: number;
  shipping: { firstName: string; lastName: string; postalCode: string };
  createdAt: string;
  updatedAt: string;
}

const hash = (password: string) => crypto.createHash('sha256').update(password).digest('hex');
export const money = (value: number) => Math.round(value * 100) / 100;

/** In-memory state. Restarting the server (or POST /__test/reset) returns to the seed. */
class Store {
  products = new Map<number, Product>();
  users = new Map<string, User>();
  sessions = new Map<string, { userId: number; expiresAt: number }>();
  carts = new Map<number, CartLine[]>();
  orders = new Map<string, Order>();
  idempotency = new Map<string, string>();
  private nextProductId = 1;
  private nextUserId = 1;
  private nextOrderNo = 1;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.products.clear(); this.users.clear(); this.sessions.clear();
    this.carts.clear(); this.orders.clear(); this.idempotency.clear();
    this.nextProductId = 1; this.nextUserId = 1; this.nextOrderNo = 1;

    const seed: Array<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>> = [
      { sku: 'SL-BACKPACK', name: 'Sauce Labs Backpack', description: 'Carry all the things.', price: 29.99, category: 'bags', stock: 50 },
      { sku: 'SL-BIKE-LIGHT', name: 'Sauce Labs Bike Light', description: 'A red light for night rides.', price: 9.99, category: 'accessories', stock: 100 },
      { sku: 'SL-BOLT-TEE', name: 'Sauce Labs Bolt T-Shirt', description: 'Soft cotton tee.', price: 15.99, category: 'apparel', stock: 75 },
      { sku: 'SL-FLEECE', name: 'Sauce Labs Fleece Jacket', description: 'Midweight quarter-zip fleece.', price: 49.99, category: 'apparel', stock: 20 },
      { sku: 'SL-ONESIE', name: 'Sauce Labs Onesie', description: 'Rib snap infant onesie.', price: 7.99, category: 'apparel', stock: 30 },
      { sku: 'SL-RED-TEE', name: 'Test.allTheThings() T-Shirt (Red)', description: 'Classic red tee.', price: 15.99, category: 'apparel', stock: 3 },
    ];
    for (const p of seed) this.createProduct(p);

    const username = process.env.API_USERNAME || 'api_user';
    const password = process.env.API_PASSWORD || 'change-me-please';
    this.createUser(username, password);
    this.createUser('locked_api_user', password).locked = true;
  }

  createProduct(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
    const now = new Date().toISOString();
    const product: Product = { id: this.nextProductId++, ...data, price: money(data.price), createdAt: now, updatedAt: now };
    this.products.set(product.id, product);
    return product;
  }

  skuTaken(sku: string, exceptId?: number): boolean {
    return [...this.products.values()].some((p) => p.sku === sku && p.id !== exceptId);
  }

  createUser(username: string, password: string): User {
    const user: User = { id: this.nextUserId++, username, passwordHash: hash(password), locked: false };
    this.users.set(username, user);
    return user;
  }

  checkPassword(user: User, password: string): boolean {
    const a = Buffer.from(user.passwordHash);
    const b = Buffer.from(hash(password));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  createSession(userId: number): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    this.sessions.set(token, { userId, expiresAt });
    return { token, expiresAt };
  }

  cart(userId: number): CartLine[] {
    if (!this.carts.has(userId)) this.carts.set(userId, []);
    return this.carts.get(userId)!;
  }

  nextOrderId(): string {
    return `ORD-${String(this.nextOrderNo++).padStart(6, '0')}`;
  }
}

export const store = new Store();

/** Cart as returned by the API: lines priced from the current catalog. */
export function cartView(userId: number) {
  const items = store.cart(userId).map((line) => {
    const product = store.products.get(line.productId)!;
    return {
      productId: line.productId,
      name: product.name,
      unitPrice: product.price,
      quantity: line.quantity,
      lineTotal: money(product.price * line.quantity),
    };
  });
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: money(items.reduce((sum, i) => sum + i.lineTotal, 0)),
  };
}
