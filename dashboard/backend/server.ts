import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { runsRepo } from './db/repositories.ts';
import { FRONTEND_DIST, RUNS_DIR } from './paths.ts';
import { runsRouter } from './routes/runs.ts';
import { testsRouter } from './routes/tests.ts';
import { dashboardRouter } from './routes/dashboard.ts';

const HOST = process.env.DASHBOARD_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DASHBOARD_PORT ?? 4000);

runsRepo.markStaleRunsInterrupted();
fs.mkdirSync(RUNS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '100kb' }));

app.use('/api/runs', runsRouter);
app.use('/api/tests', testsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Screenshots, videos, traces and per-run HTML reports.
app.use('/artifacts', express.static(RUNS_DIR, { fallthrough: false }));

// Built frontend (npm run build). In dev, Vite serves the UI and proxies /api here.
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/(api|artifacts)\/).*/, (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err.status === 'number' ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
};
app.use(onError);

app.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
});
