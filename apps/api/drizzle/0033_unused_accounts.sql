ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "inactivity_notices" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "inactivity_notice_at" timestamp with time zone;