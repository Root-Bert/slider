ALTER TABLE "workspace_removals" DROP CONSTRAINT "workspace_removals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_removals" DROP CONSTRAINT "workspace_removals_workspace_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "workspace_removals" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_removals" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "workspace_removals" ADD CONSTRAINT "workspace_removals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_removals_user_idx" ON "workspace_removals" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_removals_email_idx" ON "workspace_removals" USING btree ("workspace_id","email_hash");