CREATE TABLE "deck_creations" (
	"deck_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"kind" text,
	"pages" integer,
	"template_id" text,
	"description" text,
	"outline" jsonb,
	"built" integer DEFAULT 0 NOT NULL,
	"idle_seq" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_creations" ADD CONSTRAINT "deck_creations_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;
