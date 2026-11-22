-- What the AI said about a mail conversation in the panel beside it (bullets, names), kept for its
-- person while the conversation's latest mail is the same (`version`), so opening it again asks the
-- model nothing. Sealed like the mail; the retention job drops rows older than 14 days.
CREATE TABLE "mail_insights" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_insights" ADD CONSTRAINT "mail_insights_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_insights" ADD CONSTRAINT "mail_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_insights_created_idx" ON "mail_insights" USING btree ("created_at");
