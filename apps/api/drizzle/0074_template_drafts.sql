ALTER TABLE "decks" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "template_design" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_masters" ADD COLUMN "draft_deck_id" text;--> statement-breakpoint
ALTER TABLE "workspace_masters" ADD CONSTRAINT "workspace_masters_draft_deck_id_decks_id_fk" FOREIGN KEY ("draft_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;