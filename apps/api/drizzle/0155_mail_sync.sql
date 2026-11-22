-- How often a person's mailboxes are read from their servers (minutes): null the clock's round
-- (every minute), 0 only when asked („Aktualisieren“).
ALTER TABLE "users" ADD COLUMN "mail_sync_minutes" integer;
