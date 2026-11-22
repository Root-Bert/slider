-- Drafts kept for the account, not only in one browser: what a person wrote and did not send –
-- in a conversation, to an agent, as a mail – waits for them on every device. Their words and the
-- names of where it goes are sealed; one draft per person, workspace and key (the client's).
CREATE TABLE "sender_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"target" jsonb NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_drafts" ADD CONSTRAINT "sender_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_drafts" ADD CONSTRAINT "sender_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sender_drafts_person_key_idx" ON "sender_drafts" USING btree ("user_id","workspace_id","key");
