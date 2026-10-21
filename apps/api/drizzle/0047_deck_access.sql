CREATE TABLE "deck_access_grants" (
	"deck_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_access_grants_deck_id_user_id_pk" PRIMARY KEY("deck_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "restricted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deck_access_grants" ADD CONSTRAINT "deck_access_grants_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_access_grants" ADD CONSTRAINT "deck_access_grants_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_access_grants_member_idx" ON "deck_access_grants" USING btree ("workspace_id","user_id");