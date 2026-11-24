CREATE TABLE "sender_channel_agents" (
	"channel_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_channel_agents_channel_id_agent_id_pk" PRIMARY KEY("channel_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "sender_channel_agents" ADD CONSTRAINT "sender_channel_agents_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_channel_agents" ADD CONSTRAINT "sender_channel_agents_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_channel_agents" ADD CONSTRAINT "sender_channel_agents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sender_channel_agents_agent_idx" ON "sender_channel_agents" USING btree ("agent_id");--> statement-breakpoint
INSERT INTO "sender_channel_agents" ("channel_id", "agent_id", "added_by") SELECT c."id", c."agent_id", a."user_id" FROM "sender_channels" c JOIN "cloud_agents" a ON a."id" = c."agent_id" WHERE c."kind" IN ('group', 'direct');--> statement-breakpoint
UPDATE "sender_channels" SET "agent_id" = NULL WHERE "kind" IN ('group', 'direct');
