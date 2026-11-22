-- The agent one tags in a conversation (`@Agent`): an area's own, made when first tagged, or the
-- one added to a group or direct conversation. Its chat stays when it is taken out.
ALTER TABLE "sender_channels" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "sender_channels" ADD CONSTRAINT "sender_channels_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE set null ON UPDATE no action;
