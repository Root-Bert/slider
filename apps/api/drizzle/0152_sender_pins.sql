-- „Anpinnen“ in Sender: the chats (a conversation or an agent) and mails each person keeps at the
-- top of their lists, the latest pinned first. One row per person and pinned thing; it goes with
-- the person and with what was pinned.
CREATE TABLE "sender_pins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text,
	"agent_id" text,
	"thread_id" text,
	"pinned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sender_pins_target_check" CHECK (num_nonnulls("sender_pins"."channel_id", "sender_pins"."agent_id", "sender_pins"."thread_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "sender_pins" ADD CONSTRAINT "sender_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_pins" ADD CONSTRAINT "sender_pins_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_pins" ADD CONSTRAINT "sender_pins_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_pins" ADD CONSTRAINT "sender_pins_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sender_pins_channel_idx" ON "sender_pins" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_pins_agent_idx" ON "sender_pins" USING btree ("user_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_pins_thread_idx" ON "sender_pins" USING btree ("user_id","thread_id");
