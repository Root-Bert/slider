-- Templates are saved to the library as they are made: designs from before that never made it
-- there have no way back (the „Nicht gespeicherte Vorlagen“ list is gone). Their blobs stay.
DELETE FROM "decks" WHERE "is_template" = true AND NOT EXISTS (SELECT 1 FROM "workspace_masters" WHERE "workspace_masters"."draft_deck_id" = "decks"."id");
