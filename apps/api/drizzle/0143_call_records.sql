-- A call that is over, as it was written down: who was in it, every turn (people and the agent),
-- the orders sent, and the notes the AI writes once after it (summary, decisions, to-dos, links).
-- An own call with an agent stands in that agent's chat as one entry (`cloud_agent_messages.call_id`).
CREATE TABLE "call_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text,
	"agent_id" text,
	"area_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"started_by" text,
	"person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"people" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"orders" jsonb NOT NULL,
	"notes" jsonb,
	"notes_state" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_records_channel_idx" ON "call_records" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "call_records_agent_idx" ON "call_records" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD COLUMN "call_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agent_messages" ADD CONSTRAINT "cloud_agent_messages_call_id_call_records_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call_records"("id") ON DELETE cascade ON UPDATE no action;
