-- Files put on a mail being written: waiting until the mail goes (then its attachments), gone
-- after seven days unsent. One row per file, under its mailbox; it goes with the mailbox.
CREATE TABLE "mail_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_uploads" ADD CONSTRAINT "mail_uploads_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_uploads_created_idx" ON "mail_uploads" USING btree ("created_at");