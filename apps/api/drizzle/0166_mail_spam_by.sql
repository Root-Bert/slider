ALTER TABLE "mail_threads" ADD COLUMN "spam_by" text;--> statement-breakpoint
UPDATE "mail_threads" SET "spam_by" = 'server' WHERE "spam" AND EXISTS (SELECT 1 FROM "mail_messages" WHERE "mail_messages"."thread_id" = "mail_threads"."id" AND "mail_messages"."folder" = 'spam');
