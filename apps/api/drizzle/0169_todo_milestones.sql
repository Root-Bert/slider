CREATE TABLE "todo_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"area_id" text,
	"owner_id" text,
	"name" text NOT NULL,
	"due_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "start_on" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "milestone_id" text;--> statement-breakpoint
ALTER TABLE "todo_milestones" ADD CONSTRAINT "todo_milestones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_milestones" ADD CONSTRAINT "todo_milestones_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_milestones" ADD CONSTRAINT "todo_milestones_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_milestone_id_todo_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."todo_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_milestones_area_idx" ON "todo_milestones" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "todo_milestones_owner_idx" ON "todo_milestones" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "todos_milestone_idx" ON "todos" USING btree ("milestone_id");
