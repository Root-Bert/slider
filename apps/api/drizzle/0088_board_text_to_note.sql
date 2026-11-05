-- Free text on the board (the kind `text`) is gone: each becomes a free note, its frame its box.
UPDATE "deck_board_items" SET "kind" = 'note' WHERE "kind" = 'text';
