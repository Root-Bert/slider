-- Every folder of a mailbox is read (not only the inbox and the spam folder): the mailbox keeps
-- its folder list, each mail the folders it lies in (a key: `inbox`, `sent`, `archive`, `spam`,
-- `trash` for the special ones, else the folder's path). `folder` stays where it came in first.
ALTER TABLE "mail_accounts" ADD COLUMN "folders" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "folders" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "mail_messages" SET "folders" = jsonb_build_array("folder");
