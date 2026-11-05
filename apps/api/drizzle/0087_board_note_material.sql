ALTER TABLE "deck_board_items" ADD COLUMN "material_id" text;--> statement-breakpoint
ALTER TABLE "deck_board_items" ADD CONSTRAINT "deck_board_items_material_id_deck_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."deck_materials"("id") ON DELETE cascade ON UPDATE no action;
