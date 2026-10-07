ALTER TABLE "decks" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "source_change_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ms_refresh_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ms_account" text;