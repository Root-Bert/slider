-- Company designs a workspace uploaded as slide masters: the file and a picture per layout.
CREATE TABLE "workspace_masters" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"file_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"aspect_ratio" double precision NOT NULL,
	"layouts" jsonb NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_masters" ADD CONSTRAINT "workspace_masters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_masters" ADD CONSTRAINT "workspace_masters_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_masters_workspace_idx" ON "workspace_masters" USING btree ("workspace_id");