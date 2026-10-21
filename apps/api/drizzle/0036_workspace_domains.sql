ALTER TABLE "workspaces" ADD COLUMN "join_domain" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "audience_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_join_domain_unique" UNIQUE("join_domain");