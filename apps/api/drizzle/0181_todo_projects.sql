CREATE TABLE "todo_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"area_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todo_milestones" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "todo_projects" ADD CONSTRAINT "todo_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_projects" ADD CONSTRAINT "todo_projects_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_projects_area_idx" ON "todo_projects" USING btree ("area_id");--> statement-breakpoint
ALTER TABLE "todo_milestones" ADD CONSTRAINT "todo_milestones_project_id_todo_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."todo_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_project_id_todo_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."todo_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_milestones_project_idx" ON "todo_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "todos_project_idx" ON "todos" USING btree ("project_id");