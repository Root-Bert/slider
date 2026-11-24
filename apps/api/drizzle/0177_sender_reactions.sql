-- Reactions on Sender messages, one per person (as on comments).
CREATE TABLE "sender_reactions" (
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_reactions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sender_reactions" ADD CONSTRAINT "sender_reactions_message_id_sender_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."sender_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_reactions" ADD CONSTRAINT "sender_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sender_reactions_user_idx" ON "sender_reactions" USING btree ("user_id");
