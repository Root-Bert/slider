ALTER TABLE "mail_messages" ADD COLUMN "seen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "seen_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "mail_messages" AS m SET "seen" = true WHERE m."outgoing" OR m."folder" NOT IN ('inbox', 'spam') OR m."thread_id" IS NULL OR EXISTS (SELECT 1 FROM "mail_threads" AS t WHERE t."id" = m."thread_id" AND t."read_at" IS NOT NULL AND m."created_at" <= t."read_at");--> statement-breakpoint
CREATE INDEX "mail_messages_seen_pending_idx" ON "mail_messages" USING btree ("account_id") WHERE "mail_messages"."seen_pending";
