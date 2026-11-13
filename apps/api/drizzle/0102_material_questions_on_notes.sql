-- Questions of the former side panel belong to no note: they go (never in a release).
DELETE FROM "material_questions";--> statement-breakpoint
ALTER TABLE "material_questions" DROP CONSTRAINT "material_questions_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "material_questions_deck_user_idx";--> statement-breakpoint
ALTER TABLE "material_questions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD COLUMN "note_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD CONSTRAINT "material_questions_note_id_deck_board_items_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."deck_board_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_questions" ADD CONSTRAINT "material_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_questions_note_idx" ON "material_questions" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "material_questions_deck_idx" ON "material_questions" USING btree ("deck_id","created_at");