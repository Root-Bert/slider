CREATE TABLE "deleted_pptx_comments" (
	"deck_id" text NOT NULL,
	"external_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deleted_pptx_comments_deck_id_external_id_pk" PRIMARY KEY("deck_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "deleted_pptx_comments" ADD CONSTRAINT "deleted_pptx_comments_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;