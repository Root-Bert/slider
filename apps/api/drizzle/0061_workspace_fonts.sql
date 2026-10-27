-- Fonts a workspace uploaded, one face each: its decks are drawn in them.
CREATE TABLE "workspace_fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer NOT NULL,
	"italic" boolean NOT NULL,
	"format" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"upm" integer NOT NULL,
	"ascent" integer NOT NULL,
	"descent" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_fonts" ADD CONSTRAINT "workspace_fonts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_fonts" ADD CONSTRAINT "workspace_fonts_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_fonts_face_idx" ON "workspace_fonts" USING btree ("workspace_id","family","weight","italic");