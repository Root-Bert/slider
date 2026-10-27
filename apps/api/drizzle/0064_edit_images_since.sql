ALTER TABLE "decks" ADD COLUMN "edit_images_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "decks_edit_images_since_idx" ON "decks" USING btree ("edit_images_since") WHERE "decks"."edit_images_since" is not null;--> statement-breakpoint
-- Pictures uploaded before this was noted: every deck is looked at once, seven days from now.
UPDATE "decks" SET "edit_images_since" = now();
