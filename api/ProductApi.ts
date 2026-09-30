import type { ApiClient } from './ApiClient';
import type { Product, ProductInput, ProductList, ProductQuery } from './types';

export class ProductApi {
  constructor(private readonly client: ApiClient) {}

  list(query: ProductQuery = {}) {
    return this.client.get<ProductList>('/api/products', { params: { ...query } });
  }

  get(id: number | string) {
    return this.client.get<Product>(`/api/products/${id}`);
  }

  create(input: ProductInput | Record<string, unknown>) {
    return this.client.post<Product>('/api/products', input);
  }

  replace(id: number, input: ProductInput | Record<string, unknown>) {
    return this.client.put<Product>(`/api/products/${id}`, input);
  }

  update(id: number, patch: Partial<ProductInput> | Record<string, unknown>) {
    return this.client.patch<Product>(`/api/products/${id}`, patch);
  }

  remove(id: number) {
    return this.client.delete<null>(`/api/products/${id}`);
  }
}
