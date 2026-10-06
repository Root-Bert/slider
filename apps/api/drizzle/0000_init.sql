CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"slide_id" text,
	"parent_id" text,
	"author" jsonb NOT NULL,
	"body" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"strokes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"source" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_deck_source_external_unique" UNIQUE("deck_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"import_state" jsonb NOT NULL,
	"current_revision_id" text
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"review_link_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_links" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"token" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pptx_key" text,
	"slide_width_emu" integer,
	"slide_height_emu" integer,
	CONSTRAINT "revisions_deck_number_unique" UNIQUE("deck_id","number")
);
--> statement-breakpoint
CREATE TABLE "slide_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"slide_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"position" integer NOT NULL,
	"pptx_sld_id" integer,
	"hidden" boolean DEFAULT false NOT NULL,
	"title" text,
	"layout_name" text,
	"text_hash" text,
	"image_key" text NOT NULL,
	"thumbnail_key" text NOT NULL,
	"aspect_ratio" double precision NOT NULL,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "slide_versions_revision_slide_unique" UNIQUE("revision_id","slide_id")
);
--> statement-breakpoint
CREATE TABLE "slides" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"color" text NOT NULL,
	"avatar_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_slide_id_slides_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."slides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_current_revision_id_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_review_link_id_review_links_id_fk" FOREIGN KEY ("review_link_id") REFERENCES "public"."review_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_links" ADD CONSTRAINT "review_links_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide_versions" ADD CONSTRAINT "slide_versions_slide_id_slides_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."slides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide_versions" ADD CONSTRAINT "slide_versions_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slides" ADD CONSTRAINT "slides_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_deck_created_idx" ON "comments" USING btree ("deck_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "decks_owner_updated_idx" ON "decks" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "guest_sessions_review_link_idx" ON "guest_sessions" USING btree ("review_link_id");--> statement-breakpoint
CREATE INDEX "review_links_deck_idx" ON "review_links" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "slide_versions_revision_position_idx" ON "slide_versions" USING btree ("revision_id","position");--> statement-breakpoint
CREATE INDEX "slides_deck_idx" ON "slides" USING btree ("deck_id");