CREATE TABLE "deck_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "deck_folders" ADD CONSTRAINT "deck_folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_folders" ADD CONSTRAINT "deck_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_folders_workspace_idx" ON "deck_folders" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_folder_id_deck_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."deck_folders"("id") ON DELETE set null ON UPDATE no action;