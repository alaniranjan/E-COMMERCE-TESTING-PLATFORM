/** Contract of the controlled test API (mock-api/). */
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
export type ProductInput = Pick<Product, 'sku' | 'name' | 'price' | 'category' | 'stock'> & { description?: string };

export interface ProductList {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductQuery {
  category?: Category;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';
  page?: number;
  pageSize?: number;
}

export interface CartItem {
  productId: number;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}
export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}

export interface Shipping {
  firstName: string;
  lastName: string;
  postalCode: string;
}
export interface Order {
  id: string;
  userId: number;
  status: 'placed' | 'cancelled';
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  shipping: Shipping;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  token: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: number; username: string };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}
