-- What an agent wants done that cannot be undone or reaches out: asked in its chat, done on the person's „Bestätigen“.
CREATE TABLE "cloud_agent_asks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"text" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"result" text,
	"unattended" boolean DEFAULT false NOT NULL,
	"foreign" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cloud_agent_asks" ADD CONSTRAINT "cloud_agent_asks_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_asks" ADD CONSTRAINT "cloud_agent_asks_chat_id_cloud_agent_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."cloud_agent_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_asks" ADD CONSTRAINT "cloud_agent_asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_agent_asks_chat_idx" ON "cloud_agent_asks" USING btree ("chat_id","created_at");
