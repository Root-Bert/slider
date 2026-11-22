-- The channel „Entwürfe“ that 0129 kept of the old drafts area goes where nothing was written in
-- it: it looked like a channel of the workspace's own. One made later under that name stays.
DELETE FROM "sender_channels" c
USING "cloud_areas" r
WHERE c."area_id" = r."id" AND r."root" AND c."kind" = 'channel' AND c."name" = 'Entwürfe'
  AND c."created_at" < '2026-11-19T17:03:50+01:00'
  AND NOT EXISTS (
    SELECT 1 FROM "sender_messages" m WHERE m."channel_id" = c."id" AND m."deleted_at" IS NULL
  );
