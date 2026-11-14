DROP INDEX "material_questions_note_idx";--> statement-breakpoint
ALTER TABLE "material_questions" ALTER COLUMN "state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD COLUMN "kind" text DEFAULT 'note' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD COLUMN "author" jsonb;--> statement-breakpoint
CREATE INDEX "material_questions_note_idx" ON "material_questions" USING btree ("note_id","created_at");