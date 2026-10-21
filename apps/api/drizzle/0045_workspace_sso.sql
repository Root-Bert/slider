CREATE TABLE "workspace_sso" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"verify_token" text NOT NULL,
	"verified_domain" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_sso" ADD CONSTRAINT "workspace_sso_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;