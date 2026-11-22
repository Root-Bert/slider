ALTER TABLE "cloud_agents" ADD COLUMN "repeat" jsonb;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD COLUMN "repeat_text" text;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "cloud_agents_next_run_idx" ON "cloud_agents" USING btree ("next_run_at");
