ALTER TABLE "decks" ADD COLUMN "linked_by_id" text;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Decks so far were linked by their owner; one already handed to an heir cannot be told apart.
UPDATE "decks" SET "linked_by_id" = "owner_id";