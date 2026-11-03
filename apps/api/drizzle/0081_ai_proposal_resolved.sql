ALTER TABLE "ai_proposals" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD COLUMN "resolved_at" timestamp with time zone;
