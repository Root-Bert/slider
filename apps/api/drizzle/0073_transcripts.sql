ALTER TABLE "media" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "transcript_status" text DEFAULT 'none' NOT NULL;