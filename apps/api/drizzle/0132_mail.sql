CREATE TABLE "mail_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer NOT NULL,
	"imap_secure" boolean NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer NOT NULL,
	"smtp_secure" boolean NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"error" text,
	"sync" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"thread_id" text,
	"sender_message_id" text,
	"folder" text NOT NULL,
	"uid" integer,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from" jsonb NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb NOT NULL,
	"auth" text DEFAULT 'none' NOT NULL,
	"outgoing" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subject" text NOT NULL,
	"spam" boolean DEFAULT false NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"context" jsonb,
	"context_state" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_messages" ADD COLUMN "mail" jsonb;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_thread_id_mail_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_sender_message_id_sender_messages_id_fk" FOREIGN KEY ("sender_message_id") REFERENCES "public"."sender_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_accounts_person_idx" ON "mail_accounts" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_message_idx" ON "mail_messages" USING btree ("account_id","message_id");--> statement-breakpoint
CREATE INDEX "mail_messages_thread_idx" ON "mail_messages" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "mail_threads_account_idx" ON "mail_threads" USING btree ("account_id","last_at");