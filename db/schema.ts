import { index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Property names are snake_case so rows match the dashboard's API types (dashboard/frontend/src/api/types.ts).

/** One test run dispatched from the hosted dashboard and executed in GitHub Actions. */
export const runs = pgTable('runs', {
  id: text('id').primaryKey(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
  suite: text('suite').notNull(),
  browser: text('browser').notNull(),
  environment: text('environment').notNull(),
  base_url: text('base_url').notNull(),
  status: text('status').notNull(),
  total: integer('total').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  duration_ms: integer('duration_ms').notNull().default(0),
  ai_analysis_count: integer('ai_analysis_count').notNull().default(0),
  exit_code: integer('exit_code'),
  error_message: text('error_message'),
  report_url: text('report_url'),
  allure_url: text('allure_url'),
  /** Live progress reported by the GitHub Actions job while the run is in progress. */
  live: jsonb('live'),
}, (t) => [index('idx_runs_created').on(t.created_at)]);

export const test_results = pgTable('test_results', {
  id: serial('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  full_title: text('full_title').notNull(),
  file: text('file').notNull(),
  line: integer('line'),
  browser: text('browser').notNull(),
  status: text('status').notNull(),
  duration_ms: integer('duration_ms').notNull().default(0),
  retries: integer('retries').notNull().default(0),
  tags: text('tags').notNull().default('[]'),
  error_message: text('error_message'),
  error_stack: text('error_stack'),
  screenshot_url: text('screenshot_url'),
  video_url: text('video_url'),
  trace_url: text('trace_url'),
  trace_path: text('trace_path'),
}, (t) => [index('idx_test_results_run').on(t.run_id)]);
