CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"workspace_id" text,
	"key_id" text,
	"instance_key" boolean NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" double precision DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_key_id_integration_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."integration_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_at_idx" ON "ai_usage" USING btree ("at");