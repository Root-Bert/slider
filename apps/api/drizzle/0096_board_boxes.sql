-- Stickers and frames are one kind: a box on the board, maybe holding things (`bound_ids`).
-- Notes beside one thing stay `note`.
UPDATE "deck_board_items" SET "kind" = 'box'
WHERE "kind" = 'frame' OR ("kind" = 'note' AND jsonb_array_length("bound_ids") = 0);
