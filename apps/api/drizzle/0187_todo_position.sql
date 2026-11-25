ALTER TABLE "todos" ADD COLUMN "position" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
-- As the timeline showed them: by start (the earlier of start and due), the unplanned last, the latest first.
UPDATE "todos" SET "position" = "ordered"."n" FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "workspace_id"
    ORDER BY LEAST("start_on", "due_on") ASC NULLS LAST, "updated_at" DESC
  ) AS "n" FROM "todos"
) AS "ordered" WHERE "todos"."id" = "ordered"."id";
