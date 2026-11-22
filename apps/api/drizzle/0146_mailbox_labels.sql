-- A mailbox's own name („Arbeit“), sealed like its address; null: its default (Google, Microsoft, …).
ALTER TABLE "mail_accounts" ADD COLUMN "label" text;
