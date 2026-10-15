ALTER TABLE "media" DROP CONSTRAINT "media_comment_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "media_comment_kind_idx" ON "media" USING btree ("comment_id","kind");