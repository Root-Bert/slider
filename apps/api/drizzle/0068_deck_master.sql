ALTER TABLE "decks" ADD COLUMN "master_id" text;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_master_id_workspace_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."workspace_masters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_master_idx" ON "decks" USING btree ("master_id");