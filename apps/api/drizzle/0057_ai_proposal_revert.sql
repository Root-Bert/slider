ALTER TABLE "ai_proposals" ADD COLUMN "applied_seq" integer;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD COLUMN "revert_operations" jsonb DEFAULT '[]'::jsonb NOT NULL;