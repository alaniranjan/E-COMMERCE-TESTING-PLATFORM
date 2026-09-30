import type { ApiClient } from './ApiClient';
import type { Order, Shipping } from './types';

export class OrderApi {
  constructor(private readonly client: ApiClient) {}

  place(shipping: Partial<Shipping> | Record<string, unknown>, options: { idempotencyKey?: string } = {}) {
    const headers = options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined;
    return this.client.post<Order>('/api/orders', { shipping }, { headers });
  }

  list() {
    return this.client.get<{ items: Order[]; total: number }>('/api/orders');
  }

  get(id: string) {
    return this.client.get<Order>(`/api/orders/${id}`);
  }

  cancel(id: string) {
    return this.client.patch<Order>(`/api/orders/${id}`, { status: 'cancelled' });
  }
}
