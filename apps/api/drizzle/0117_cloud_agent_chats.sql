CREATE TABLE "cloud_agent_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every agent so far is one chat: it gets the agent's id, and its messages go into it.
INSERT INTO "cloud_agent_chats" ("id", "agent_id", "user_id", "created_at") SELECT "id", "id", "user_id", "created_at" FROM "cloud_agents";--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD COLUMN "chat_id" text;--> statement-breakpoint
UPDATE "cloud_agent_messages" SET "chat_id" = "agent_id";--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ALTER COLUMN "chat_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD COLUMN "from_chat_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agent_chats" ADD CONSTRAINT "cloud_agent_chats_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_chats" ADD CONSTRAINT "cloud_agent_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_agent_chats_agent_idx" ON "cloud_agent_chats" USING btree ("agent_id","created_at");--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD CONSTRAINT "cloud_agent_messages_chat_id_cloud_agent_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."cloud_agent_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD CONSTRAINT "cloud_agent_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;