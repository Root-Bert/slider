-- The voice agents speak with in calls is each person's own (personal settings), not the
-- workspace's: the person who calls an agent or brings it into a call hears it in theirs.
ALTER TABLE "workspaces" DROP COLUMN "call_voice";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "call_voice" text;
