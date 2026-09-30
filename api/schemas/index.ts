/**
 * JSON Schemas (draft 2020-12 subset, validated with Ajv) describing the API contract.
 * additionalProperties: false catches unexpected fields such as leaked internals.
 */
const money = { type: 'number', minimum: 0, multipleOf: 0.01 } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;

export const productSchema = {
  $id: 'product',
  type: 'object',
  required: ['id', 'sku', 'name', 'description', 'price', 'category', 'stock', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'integer', minimum: 1 },
    sku: { type: 'string', pattern: '^[A-Z0-9-]{3,20}$' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string' },
    price: { ...money, minimum: 0.01, maximum: 10000 },
    category: { enum: ['bags', 'apparel', 'accessories', 'toys'] },
    stock: { type: 'integer', minimum: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
} as const;

export const productListSchema = {
  $id: 'productList',
  type: 'object',
  required: ['items', 'total', 'page', 'pageSize'],
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: productSchema },
    total: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const cartItemSchema = {
  type: 'object',
  required: ['productId', 'name', 'unitPrice', 'quantity', 'lineTotal'],
  additionalProperties: false,
  properties: {
    productId: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1 },
    unitPrice: money,
    quantity: { type: 'integer', minimum: 1, maximum: 10 },
    lineTotal: money,
  },
} as const;

export const cartSchema = {
  $id: 'cart',
  type: 'object',
  required: ['items', 'itemCount', 'subtotal'],
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: cartItemSchema },
    itemCount: { type: 'integer', minimum: 0 },
    subtotal: money,
  },
} as const;

export const orderSchema = {
  $id: 'order',
  type: 'object',
  required: ['id', 'userId', 'status', 'items', 'subtotal', 'tax', 'total', 'shipping', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^ORD-\\d{6}$' },
    userId: { type: 'integer', minimum: 1 },
    status: { enum: ['placed', 'cancelled'] },
    items: { type: 'array', minItems: 1, items: cartItemSchema },
    subtotal: money,
    tax: money,
    total: money,
    shipping: {
      type: 'object',
      required: ['firstName', 'lastName', 'postalCode'],
      additionalProperties: false,
      properties: {
        firstName: { type: 'string', minLength: 1 },
        lastName: { type: 'string', minLength: 1 },
        postalCode: { type: 'string', minLength: 3 },
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  },
} as const;

export const loginSchema = {
  $id: 'login',
  type: 'object',
  required: ['token', 'tokenType', 'expiresIn', 'user'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 20 },
    tokenType: { const: 'Bearer' },
    expiresIn: { type: 'integer', minimum: 1 },
    user: {
      type: 'object',
      required: ['id', 'username'],
      additionalProperties: false,
      properties: { id: { type: 'integer' }, username: { type: 'string' } },
    },
  },
} as const;

export const errorSchema = {
  $id: 'error',
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', pattern: '^[A-Z_]+$' },
        message: { type: 'string', minLength: 1 },
        details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field', 'message'],
            properties: { field: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;
