ALTER TABLE "deleted_pptx_comments" ADD COLUMN "slide_id" text;--> statement-breakpoint
ALTER TABLE "deleted_pptx_comments" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "deleted_pptx_comments" ADD COLUMN "body_hash" text;--> statement-breakpoint
ALTER TABLE "deleted_pptx_comments" ADD COLUMN "comment_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "fingerprint_version" integer;