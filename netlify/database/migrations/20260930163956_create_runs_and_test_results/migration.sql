CREATE TABLE "runs" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"suite" text NOT NULL,
	"browser" text NOT NULL,
	"environment" text NOT NULL,
	"base_url" text NOT NULL,
	"status" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"flaky" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"ai_analysis_count" integer DEFAULT 0 NOT NULL,
	"exit_code" integer,
	"error_message" text,
	"report_url" text,
	"allure_url" text,
	"live" jsonb
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" serial PRIMARY KEY,
	"run_id" text NOT NULL,
	"title" text NOT NULL,
	"full_title" text NOT NULL,
	"file" text NOT NULL,
	"line" integer,
	"browser" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"error_message" text,
	"error_stack" text,
	"screenshot_url" text,
	"video_url" text,
	"trace_url" text,
	"trace_path" text
);
--> statement-breakpoint
CREATE INDEX "idx_runs_created" ON "runs" ("created_at");--> statement-breakpoint
CREATE INDEX "idx_test_results_run" ON "test_results" ("run_id");--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE;