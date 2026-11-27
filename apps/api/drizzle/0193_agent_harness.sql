CREATE TABLE "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_transcripts" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"turns" jsonb,
	"through_seq" integer DEFAULT 0 NOT NULL,
	"context_tokens" integer DEFAULT 0 NOT NULL,
	"context_window" integer,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD COLUMN "instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_transcripts" ADD CONSTRAINT "agent_transcripts_chat_id_sender_channels_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_transcripts" ADD CONSTRAINT "agent_transcripts_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memories_agent_idx" ON "agent_memories" USING btree ("agent_id");