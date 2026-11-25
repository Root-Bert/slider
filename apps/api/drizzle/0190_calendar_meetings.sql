ALTER TABLE "calendar_events" ADD COLUMN "call_channel_id" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "meeting_notice_minutes" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_call_channel_id_sender_channels_id_fk" FOREIGN KEY ("call_channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE set null ON UPDATE no action;