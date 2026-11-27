ALTER TABLE "calendar_events" ADD COLUMN "recurrence" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "exdates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeats_until" timestamp with time zone;
