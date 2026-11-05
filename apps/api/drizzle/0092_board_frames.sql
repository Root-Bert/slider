-- A note round several things becomes a frame: its own kind, its box stored – round its things
-- as they lie now (their bounds with 16 of room), as it was drawn till now.
WITH "members" AS (
  SELECT "note"."id" AS "note_id", "file"."x", "file"."y", "file"."w", "file"."h"
  FROM "deck_board_items" AS "note"
  CROSS JOIN LATERAL jsonb_array_elements_text("note"."bound_ids") AS "bound"("id")
  JOIN "deck_materials" AS "file" ON "file"."id" = "bound"."id"
  WHERE "note"."kind" = 'note' AND jsonb_array_length("note"."bound_ids") >= 2
  UNION ALL
  SELECT "note"."id", "thing"."x", "thing"."y", "thing"."w", "thing"."h"
  FROM "deck_board_items" AS "note"
  CROSS JOIN LATERAL jsonb_array_elements_text("note"."bound_ids") AS "bound"("id")
  JOIN "deck_board_items" AS "thing" ON "thing"."id" = "bound"."id"
  WHERE "note"."kind" = 'note' AND jsonb_array_length("note"."bound_ids") >= 2
), "bounds" AS (
  SELECT "note_id", min("x") - 16 AS "left", min("y") - 16 AS "top",
    max("x" + "w") + 16 AS "right", max("y" + "h") + 16 AS "bottom"
  FROM "members" GROUP BY "note_id"
)
UPDATE "deck_board_items"
SET "x" = "bounds"."left", "y" = "bounds"."top",
  "w" = "bounds"."right" - "bounds"."left", "h" = "bounds"."bottom" - "bounds"."top"
FROM "bounds" WHERE "deck_board_items"."id" = "bounds"."note_id";--> statement-breakpoint
UPDATE "deck_board_items" SET "kind" = 'frame'
WHERE "kind" = 'note' AND jsonb_array_length("bound_ids") >= 2;
