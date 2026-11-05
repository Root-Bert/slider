CREATE TABLE "show_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "deck_id" text NOT NULL REFERENCES "decks"("id") ON DELETE cascade,
  "at" timestamp with time zone NOT NULL,
  "summary" jsonb NOT NULL,
  "recording_key" text
);
--> statement-breakpoint
CREATE INDEX "show_runs_deck_idx" ON "show_runs" ("deck_id");
