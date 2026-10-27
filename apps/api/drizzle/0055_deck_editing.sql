CREATE TABLE "ai_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"slide_id" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text NOT NULL,
	"base_seq" integer NOT NULL,
	"operations" jsonb NOT NULL,
	"summary" text,
	"error" text,
	"preview_key" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"seq" integer NOT NULL,
	"file_key" text NOT NULL,
	"operations" jsonb NOT NULL,
	"source" text NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_edits_revision_seq_unique" UNIQUE("revision_id","seq")
);
--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "edit_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "saved_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ai_api_key" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ai_key_hint" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ai_key_set_by_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ai_key_set_by_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ai_key_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ai_key_error" text;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_slide_id_slides_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."slides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_edits" ADD CONSTRAINT "deck_edits_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_edits" ADD CONSTRAINT "deck_edits_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_edits" ADD CONSTRAINT "deck_edits_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_proposals_deck_idx" ON "ai_proposals" USING btree ("deck_id","created_at");--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_ai_key_set_by_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ai_key_set_by_id_users_id_fk" FOREIGN KEY ("ai_key_set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;