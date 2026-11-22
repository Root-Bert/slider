-- No „Entwürfe“ any more: what lay there goes to the workspace's own area (open to it as before).
INSERT INTO "cloud_areas" ("id", "workspace_id", "name", "color", "visibility", "position", "root")
SELECT gen_random_uuid()::text, h."workspace_id", COALESCE(w."name", 'Workspace'), 'violet', 'workspace', -2, true
FROM "cloud_areas" h
LEFT JOIN "workspaces" w ON w."id" = h."workspace_id"
WHERE h."home" AND NOT EXISTS (
  SELECT 1 FROM "cloud_areas" r WHERE r."workspace_id" = h."workspace_id" AND r."root"
);--> statement-breakpoint
UPDATE "cloud_nodes" n SET "area_id" = r."id"
FROM "cloud_areas" h, "cloud_areas" r
WHERE n."area_id" = h."id" AND h."home" AND r."workspace_id" = h."workspace_id" AND r."root";--> statement-breakpoint
UPDATE "cloud_events" e SET "area_id" = r."id"
FROM "cloud_areas" h, "cloud_areas" r
WHERE e."area_id" = h."id" AND h."home" AND r."workspace_id" = h."workspace_id" AND r."root";--> statement-breakpoint
UPDATE "cloud_agents" a SET "area_id" = r."id"
FROM "cloud_areas" h, "cloud_areas" r
WHERE a."area_id" = h."id" AND h."home" AND r."workspace_id" = h."workspace_id" AND r."root";--> statement-breakpoint
UPDATE "cloud_agent_files" f SET "area_id" = r."id"
FROM "cloud_areas" h, "cloud_areas" r
WHERE f."area_id" = h."id" AND h."home" AND r."workspace_id" = h."workspace_id" AND r."root";--> statement-breakpoint
-- Its own channel stays, with its messages: a channel „Entwürfe“ beside the workspace's own.
UPDATE "sender_channels" c SET "kind" = 'channel', "name" = 'Entwürfe'
FROM "cloud_areas" h, "cloud_areas" r
WHERE c."area_id" = h."id" AND c."kind" = 'area' AND h."home"
  AND r."workspace_id" = h."workspace_id" AND r."root"
  AND EXISTS (SELECT 1 FROM "sender_channels" o WHERE o."area_id" = r."id" AND o."kind" = 'area');--> statement-breakpoint
UPDATE "sender_channels" c SET "area_id" = r."id"
FROM "cloud_areas" h, "cloud_areas" r
WHERE c."area_id" = h."id" AND h."home" AND r."workspace_id" = h."workspace_id" AND r."root";--> statement-breakpoint
UPDATE "cloud_areas" SET "parent_id" = NULL
WHERE "parent_id" IN (SELECT "id" FROM "cloud_areas" WHERE "home");--> statement-breakpoint
DELETE FROM "cloud_areas" WHERE "home";--> statement-breakpoint
DROP INDEX "cloud_areas_home_idx";--> statement-breakpoint
ALTER TABLE "cloud_areas" DROP COLUMN "home";
