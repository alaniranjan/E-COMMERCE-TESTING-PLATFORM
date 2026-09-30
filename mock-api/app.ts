import express, { type ErrorRequestHandler } from 'express';
import { ApiError, sendError } from './errors';
import { applyFaults } from './middleware/faults';
import { authRouter } from './routes/auth';
import { cartRouter } from './routes/cart';
import { ordersRouter } from './routes/orders';
import { productsRouter } from './routes/products';
import { testControlRouter } from './routes/testControl';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  if (process.env.MOCK_API_TEST_CONTROLS !== 'false') app.use('/__test', testControlRouter);

  app.use('/api', applyFaults);
  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use((req, res) => sendError(res, new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`)));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ApiError) return sendError(res, err);
    // Malformed JSON from express.json()
    if (err?.type === 'entity.parse.failed') return sendError(res, new ApiError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON'));
    console.error(err);
    sendError(res, new ApiError(500, 'INTERNAL_ERROR', 'Unexpected server error'));
  };
  app.use(onError);
  return app;
}
