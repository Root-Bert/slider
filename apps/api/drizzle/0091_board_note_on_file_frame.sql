-- A note on one file has no box of its own any more (it stands beside the file): its frame becomes
-- the file's, in board units like every other frame.
UPDATE "deck_board_items" AS "note"
SET "x" = "file"."x", "y" = "file"."y", "w" = "file"."w", "h" = "file"."h"
FROM "deck_materials" AS "file"
WHERE "note"."kind" = 'note'
  AND jsonb_array_length("note"."bound_ids") = 1
  AND "note"."bound_ids" ->> 0 = "file"."id";
