ALTER TABLE "comments" ADD COLUMN "external_status" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "removed_in_source_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "content_sha256" text;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "diff" jsonb;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "slide_versions" ADD COLUMN "render_hash" text;--> statement-breakpoint
CREATE INDEX "revisions_deck_status_idx" ON "revisions" USING btree ("deck_id","status");