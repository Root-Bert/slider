CREATE TABLE "cloud_agent_files" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"node_id" text,
	"parent_id" text,
	"area_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"state" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD CONSTRAINT "cloud_agent_files_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD CONSTRAINT "cloud_agent_files_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD CONSTRAINT "cloud_agent_files_parent_id_cloud_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_files" ADD CONSTRAINT "cloud_agent_files_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD CONSTRAINT "cloud_agent_messages_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD CONSTRAINT "cloud_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD CONSTRAINT "cloud_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_agent_files_agent_idx" ON "cloud_agent_files" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_agent_messages_agent_seq_idx" ON "cloud_agent_messages" USING btree ("agent_id","seq");--> statement-breakpoint
CREATE INDEX "cloud_agents_workspace_idx" ON "cloud_agents" USING btree ("workspace_id","updated_at");