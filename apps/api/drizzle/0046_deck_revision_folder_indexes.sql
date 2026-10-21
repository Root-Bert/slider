CREATE INDEX "decks_current_revision_idx" ON "decks" USING btree ("current_revision_id");--> statement-breakpoint
CREATE INDEX "decks_folder_idx" ON "decks" USING btree ("folder_id");