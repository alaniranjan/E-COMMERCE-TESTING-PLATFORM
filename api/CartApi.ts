import type { ApiClient } from './ApiClient';
import type { Cart } from './types';

export class CartApi {
  constructor(private readonly client: ApiClient) {}

  get() {
    return this.client.get<Cart>('/api/cart');
  }

  addItem(productId: number, quantity?: number) {
    return this.client.post<Cart>('/api/cart/items', quantity === undefined ? { productId } : { productId, quantity });
  }

  updateItem(productId: number, quantity: number) {
    return this.client.patch<Cart>(`/api/cart/items/${productId}`, { quantity });
  }

  removeItem(productId: number) {
    return this.client.delete<Cart>(`/api/cart/items/${productId}`);
  }

  clear() {
    return this.client.delete<null>('/api/cart');
  }
}
