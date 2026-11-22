-- To-dos: an area's or one's own, numbered per workspace (`todos` in schema.ts).
CREATE TABLE "todos" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"area_id" text,
	"owner_id" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"assignee_id" text,
	"due_on" text,
	"source" jsonb,
	"created_by" text,
	"created_by_agent" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_created_by_agent_cloud_agents_id_fk" FOREIGN KEY ("created_by_agent") REFERENCES "public"."cloud_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "todos_number_idx" ON "todos" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "todos_area_idx" ON "todos" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "todos_owner_idx" ON "todos" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "todos_assignee_idx" ON "todos" USING btree ("assignee_id");