-- Who recorded a rehearsal (`show_runs.recording_key`): their recordings go into their data export
-- and are deleted with their account. Null for runs from before and once the account is gone.
ALTER TABLE "show_runs" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "show_runs" ADD CONSTRAINT "show_runs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
