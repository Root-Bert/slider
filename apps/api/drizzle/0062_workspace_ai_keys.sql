-- The API keys of a workspace's AI, several per workspace, one active (Anthropic, OpenAI, Gemini, OpenAI-compatible).
CREATE TABLE "workspace_ai_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"api_key" text NOT NULL,
	"hint" text NOT NULL,
	"model" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"set_by_id" text,
	"set_by_name" text,
	"set_at" timestamp with time zone NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "workspace_ai_keys" ADD CONSTRAINT "workspace_ai_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_keys" ADD CONSTRAINT "workspace_ai_keys_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_ai_keys_workspace_idx" ON "workspace_ai_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_ai_keys_active_idx" ON "workspace_ai_keys" USING btree ("workspace_id") WHERE "workspace_ai_keys"."active";