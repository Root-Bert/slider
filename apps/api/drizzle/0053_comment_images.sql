-- Several images per comment (BER-174): a position orders them; a recording keeps 0.
DROP INDEX "media_comment_kind_idx";--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_comment_kind_position_idx" ON "media" USING btree ("comment_id","kind","position");
