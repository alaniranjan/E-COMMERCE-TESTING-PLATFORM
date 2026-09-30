export interface UserRecord {
  username: string;
}
export type UsersData = Record<string, UserRecord>;

export interface NegativeLoginCase {
  username: string;
  password?: string;
  /** When true the test uses TEST_USER_PASSWORD from .env instead of `password`. */
  useValidPassword?: boolean;
  expectedError: string;
}
export interface NegativeCheckoutCase {
  customer: CustomerInfo;
  expectedError: string;
}
export interface NegativeData {
  login: Record<string, NegativeLoginCase>;
  checkout: Record<string, NegativeCheckoutCase>;
  product: { nonExistentId: number; notFoundName: string };
}

export interface Product {
  key: string;
  name: string;
  price: number;
}
export interface ProductsData {
  catalogSize: number;
  items: Product[];
}

export interface CustomerInfo {
  firstName: string;
  lastName: string;
  postalCode: string;
}
export interface CheckoutData {
  validCustomer: CustomerInfo;
  taxRate: number;
}

export interface Range { min: number; max: number; belowMin: number; aboveMax: number }
export interface ApiData {
  newProduct: { name: string; description: string; price: number; category: 'bags' | 'apparel' | 'accessories' | 'toys'; stock: number };
  boundaries: { price: Range & { tooManyDecimals: number }; quantity: Range; pageSize: Range; nameMaxLength: number };
  shipping: { valid: CustomerInfo };
  invalidShipping: Record<string, Partial<CustomerInfo>>;
  seededProducts: Record<string, { id: number; name: string; price?: number; stock?: number }>;
  taxRate: number;
}
