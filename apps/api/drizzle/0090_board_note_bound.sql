-- A note hangs on files, links or notes alike (several: its box round them): `bound_ids`.
ALTER TABLE "deck_board_items" RENAME COLUMN "material_ids" TO "bound_ids";
