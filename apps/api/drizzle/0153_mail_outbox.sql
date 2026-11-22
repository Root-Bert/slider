ALTER TABLE "mail_messages" ADD COLUMN "bcc" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "send_state" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "send_error" text;--> statement-breakpoint
CREATE INDEX "mail_messages_outbox_idx" ON "mail_messages" USING btree ("send_at") WHERE "mail_messages"."send_state" is not null;