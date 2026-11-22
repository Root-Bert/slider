ALTER TABLE "cloud_agents" ADD COLUMN "watches" jsonb;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD COLUMN "watched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;
