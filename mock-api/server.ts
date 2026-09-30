import path from 'node:path';
import { createApp } from './app';

// Standalone start (npm run mock-api) reads the project .env; under Playwright the vars are already set.
try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch {
  // No .env: defaults in store.ts apply.
}

const port = Number(process.env.MOCK_API_PORT ?? 3001);
createApp().listen(port, '127.0.0.1', () => {
  console.log(`Mock e-commerce API listening on http://127.0.0.1:${port}`);
});
