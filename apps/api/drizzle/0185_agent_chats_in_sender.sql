ALTER TABLE "sender_channels" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "sender_messages" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "sender_messages" ADD COLUMN "error" text;--> statement-breakpoint
-- A chat with an agent is a Sender conversation (kind `agent`, the same id). A tag chat's
-- (`agent:conversation`) goes: what the agent had to say there stands in that conversation.
-- Titles and messages are sealed for their old columns: `moveAgentChats` (server start) moves
-- them, then drops the old tables.
INSERT INTO "sender_channels" ("id", "workspace_id", "kind", "agent_id", "created_by", "last_seq", "created_at", "updated_at")
SELECT "c"."id", "a"."workspace_id", 'agent', "c"."agent_id", "c"."user_id", 0, "c"."created_at", "c"."created_at"
FROM "cloud_agent_chats" "c" INNER JOIN "cloud_agents" "a" ON "a"."id" = "c"."agent_id"
WHERE "c"."id" NOT LIKE '%:%';--> statement-breakpoint
ALTER TABLE "cloud_agent_asks" DROP CONSTRAINT "cloud_agent_asks_chat_id_cloud_agent_chats_id_fk";--> statement-breakpoint
DELETE FROM "cloud_agent_asks" WHERE "chat_id" NOT IN (SELECT "id" FROM "sender_channels");--> statement-breakpoint
ALTER TABLE "cloud_agent_asks" ADD CONSTRAINT "cloud_agent_asks_chat_id_sender_channels_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;
