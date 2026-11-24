-- „Antworten“: the message a Sender message answers, quoted above it.
ALTER TABLE "sender_messages" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "sender_messages" ADD CONSTRAINT "sender_messages_reply_to_sender_messages_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."sender_messages"("id") ON DELETE set null ON UPDATE no action;
