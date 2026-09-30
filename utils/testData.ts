import fs from 'fs';
import path from 'path';
import { config } from './config';
import { readJson } from './fileUtils';
import type { Product, ProductsData } from '../test-data/types';

const DATA_DIR = path.resolve(__dirname, '..', 'test-data');

/**
 * Loads test-data/<name>.json. If test-data/<TEST_ENV>/<name>.json exists,
 * that environment-specific file is used instead.
 */
export function loadTestData<T>(name: string): T {
  const envFile = path.join(DATA_DIR, config.testEnv, `${name}.json`);
  const defaultFile = path.join(DATA_DIR, `${name}.json`);
  const file = fs.existsSync(envFile) ? envFile : defaultFile;
  if (!fs.existsSync(file)) throw new Error(`Test data file not found: ${file}`);
  return readJson<T>(file);
}

/** Look up a catalog product by its key in products.json (e.g. "backpack"). */
export function findProduct(data: ProductsData, key: string): Product {
  const product = data.items.find((p) => p.key === key);
  if (!product) throw new Error(`Unknown product key "${key}" in products.json`);
  return product;
}
