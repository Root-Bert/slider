CREATE TABLE "sender_agent_reads" (
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sender_agent_reads_agent_id_user_id_pk" PRIMARY KEY("agent_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sender_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"area_id" text,
	"name" text DEFAULT '' NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"created_by" text,
	"direct_key" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_members" (
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sender_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"seq" integer NOT NULL,
	"user_id" text,
	"agent_id" text,
	"text" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_agent_reads" ADD CONSTRAINT "sender_agent_reads_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_agent_reads" ADD CONSTRAINT "sender_agent_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_channels" ADD CONSTRAINT "sender_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_channels" ADD CONSTRAINT "sender_channels_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_channels" ADD CONSTRAINT "sender_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_members" ADD CONSTRAINT "sender_members_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_members" ADD CONSTRAINT "sender_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_messages" ADD CONSTRAINT "sender_messages_channel_id_sender_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sender_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_messages" ADD CONSTRAINT "sender_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_messages" ADD CONSTRAINT "sender_messages_agent_id_cloud_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."cloud_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sender_channels_workspace_idx" ON "sender_channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_channels_area_idx" ON "sender_channels" USING btree ("area_id") WHERE "sender_channels"."kind" = 'area';--> statement-breakpoint
CREATE UNIQUE INDEX "sender_channels_direct_idx" ON "sender_channels" USING btree ("workspace_id","direct_key");--> statement-breakpoint
CREATE INDEX "sender_members_user_idx" ON "sender_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_messages_channel_seq_idx" ON "sender_messages" USING btree ("channel_id","seq");