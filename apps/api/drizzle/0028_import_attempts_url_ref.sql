ALTER TABLE "revisions" ADD COLUMN "import_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Plain-URL decks used to keep the URL after redirects (often a short-lived signed download URL)
-- as their sync reference; the link the user pasted is the stable one.
UPDATE "decks" SET "source_ref" = "source_url" WHERE "source" = 'url' AND "source_url" IS NOT NULL AND "source_ref" IS DISTINCT FROM "source_url";
