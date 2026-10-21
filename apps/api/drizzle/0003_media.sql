CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"uploader_id" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"peaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"transcript" text,
	"transcript_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_comment_id_unique" UNIQUE("comment_id")
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_owner_idx" ON "media" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "media_deck_idx" ON "media" USING btree ("deck_id");