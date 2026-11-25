CREATE TABLE "sender_scheduled" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" text,
	"send_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_scheduled" ADD CONSTRAINT "sender_scheduled_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_scheduled" ADD CONSTRAINT "sender_scheduled_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_scheduled" ADD CONSTRAINT "sender_scheduled_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_scheduled" ADD CONSTRAINT "sender_scheduled_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_scheduled" ADD CONSTRAINT "sender_scheduled_reply_to_sender_messages_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."sender_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sender_scheduled_due_idx" ON "sender_scheduled" USING btree ("state","send_at");--> statement-breakpoint
CREATE INDEX "sender_scheduled_person_idx" ON "sender_scheduled" USING btree ("user_id","channel_id");