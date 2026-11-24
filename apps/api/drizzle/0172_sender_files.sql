-- A file sent in a conversation (Sender): where it lies in Cloud – an area's chat puts it into
-- the area's „Chat-Dateien“ at once, elsewhere once filed – and where the AI would put it
-- (`filing`, sealed). Gone with its message, its conversation, its attachment.
CREATE TABLE "sender_files" (
	"attachment_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text,
	"node_id" text,
	"filing" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_message_id_sender_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."sender_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sender_files_channel_idx" ON "sender_files" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "sender_files_node_idx" ON "sender_files" USING btree ("node_id");
