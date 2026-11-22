-- A mail's HTML part, sanitized (`services/mail-html.ts`) and sealed like its text, and the pictures
-- its HTML shows from the mail itself (`cid:`), kept in the blob store like attachments. Each
-- mailbox reads its inbox's latest mails once more (`html_read`), so they get their HTML too.
ALTER TABLE "mail_messages" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "inline_images" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "html_read" boolean DEFAULT false NOT NULL;
