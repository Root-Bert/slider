ALTER TABLE "todo_projects" ALTER COLUMN "area_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "todo_projects" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "todo_projects" ADD CONSTRAINT "todo_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_projects_owner_idx" ON "todo_projects" USING btree ("owner_id");