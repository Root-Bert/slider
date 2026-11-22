ALTER TABLE "cloud_agent_files" ADD COLUMN "desk_parent_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD COLUMN "deck_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD COLUMN "original_deck_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD CONSTRAINT "cloud_agent_files_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD CONSTRAINT "cloud_agent_files_original_deck_id_decks_id_fk" FOREIGN KEY ("original_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;