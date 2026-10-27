ALTER TABLE "ai_proposals" DROP COLUMN "operations";--> statement-breakpoint
ALTER TABLE "ai_proposals" DROP COLUMN "preview_key";--> statement-breakpoint
ALTER TABLE "ai_proposals" DROP COLUMN "revert_operations";--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD COLUMN "changes" jsonb DEFAULT '[]'::jsonb NOT NULL;