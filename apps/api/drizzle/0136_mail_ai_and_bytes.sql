-- Whether the workspace's AI reads a mailbox's new mails by itself (on unless its person turns it
-- off), and the bytes of a mail's kept attachments, unencrypted so a workspace's storage can sum
-- them – mails from before count 0.
ALTER TABLE "mail_accounts" ADD COLUMN "ai_reads" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "attachment_bytes" bigint DEFAULT 0 NOT NULL;
