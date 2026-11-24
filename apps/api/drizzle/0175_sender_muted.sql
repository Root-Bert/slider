-- „Stummschalten“ per conversation and person: no count on the app's icon, no notification.
ALTER TABLE "sender_members" ADD COLUMN "muted" boolean DEFAULT false NOT NULL;
