-- A note may lie on several files: their ids as a list (a note on one file keeps its box on it).
ALTER TABLE "deck_board_items" ADD COLUMN "material_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "deck_board_items" SET "material_ids" = jsonb_build_array("material_id") WHERE "material_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_board_items" DROP CONSTRAINT "deck_board_items_material_id_deck_materials_id_fk";--> statement-breakpoint
ALTER TABLE "deck_board_items" DROP COLUMN "material_id";
