DROP TABLE "guest_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "review_links" CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "deck_id" text;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_invites_deck_idx" ON "workspace_invites" USING btree ("deck_id");