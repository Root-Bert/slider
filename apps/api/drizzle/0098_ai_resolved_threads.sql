-- Threads the AI changed something for are done by the AI from now on (`resolveThread`); those
-- from before follow: open, a change of its applied, its latest answer not asking back.
UPDATE "comments" AS "root"
SET "status" = 'done', "resolved_by" = 'ai', "resolved_at" = "changed"."resolved"
FROM (
  SELECT COALESCE("c"."parent_id", "c"."id") AS "root_id", max("p"."updated_at") AS "resolved"
  FROM "ai_proposals" AS "p"
  JOIN "comments" AS "c" ON "c"."id" = "p"."comment_id"
  WHERE "p"."status" = 'applied'
  GROUP BY 1
) AS "changed"
WHERE "root"."id" = "changed"."root_id"
  AND "root"."status" = 'open'
  AND NOT COALESCE((
    SELECT "p"."asks"
    FROM "ai_proposals" AS "p"
    JOIN "comments" AS "c" ON "c"."id" = "p"."comment_id"
    WHERE COALESCE("c"."parent_id", "c"."id") = "root"."id" AND "p"."status" <> 'running'
    ORDER BY "p"."created_at" DESC
    LIMIT 1
  ), false);
