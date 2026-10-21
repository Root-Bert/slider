ALTER TABLE "revisions" ADD COLUMN "files_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slide_versions" ADD COLUMN "files_deleted" boolean DEFAULT false NOT NULL;