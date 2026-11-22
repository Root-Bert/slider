-- An agent sent on a to-do: it works on it, its avatar beside it.
ALTER TABLE "todos" ADD COLUMN "assignee_agent_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_agent_id_cloud_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE set null ON UPDATE no action;