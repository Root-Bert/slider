ALTER TABLE "decks" ADD COLUMN "deletion_notices" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "deletion_notice_at" timestamp with time zone;