CREATE TABLE "cloud_area_members" (
	"area_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_area_members_area_id_user_id_pk" PRIMARY KEY("area_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cloud_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text NOT NULL,
	"visibility" text DEFAULT 'workspace' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"area_id" text,
	"space_owner_id" text,
	"node_id" text,
	"actor_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"node_kind" text,
	"detail" text,
	"more" integer DEFAULT 0 NOT NULL,
	"group_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"area_id" text,
	"owner_id" text,
	"parent_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"extension" text DEFAULT '' NOT NULL,
	"mime_type" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"current_version_id" text,
	"version_count" integer DEFAULT 0 NOT NULL,
	"thumbnail" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_root_id" text
);
--> statement-breakpoint
CREATE TABLE "cloud_recents" (
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "cloud_recents_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "cloud_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"node_id" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"role" text DEFAULT 'view' NOT NULL,
	"token_hash" text,
	"token" text,
	"expires_at" timestamp with time zone,
	"opens" integer DEFAULT 0 NOT NULL,
	"seen_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "cloud_stars" (
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_stars_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "cloud_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text,
	"label" text,
	"restored_from" integer,
	"preview" text DEFAULT 'none' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_area_members" ADD CONSTRAINT "cloud_area_members_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_area_members" ADD CONSTRAINT "cloud_area_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_areas" ADD CONSTRAINT "cloud_areas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_areas" ADD CONSTRAINT "cloud_areas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_events" ADD CONSTRAINT "cloud_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_events" ADD CONSTRAINT "cloud_events_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_events" ADD CONSTRAINT "cloud_events_space_owner_id_users_id_fk" FOREIGN KEY ("space_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_events" ADD CONSTRAINT "cloud_events_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_events" ADD CONSTRAINT "cloud_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD CONSTRAINT "cloud_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD CONSTRAINT "cloud_nodes_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD CONSTRAINT "cloud_nodes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD CONSTRAINT "cloud_nodes_parent_id_cloud_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD CONSTRAINT "cloud_nodes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD CONSTRAINT "cloud_nodes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_recents" ADD CONSTRAINT "cloud_recents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_recents" ADD CONSTRAINT "cloud_recents_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_shares" ADD CONSTRAINT "cloud_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_shares" ADD CONSTRAINT "cloud_shares_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_shares" ADD CONSTRAINT "cloud_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_shares" ADD CONSTRAINT "cloud_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_stars" ADD CONSTRAINT "cloud_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_stars" ADD CONSTRAINT "cloud_stars_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_versions" ADD CONSTRAINT "cloud_versions_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_versions" ADD CONSTRAINT "cloud_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_versions" ADD CONSTRAINT "cloud_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_area_members_user_idx" ON "cloud_area_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cloud_areas_workspace_idx" ON "cloud_areas" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "cloud_events_workspace_idx" ON "cloud_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "cloud_events_node_idx" ON "cloud_events" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "cloud_nodes_parent_idx" ON "cloud_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "cloud_nodes_workspace_idx" ON "cloud_nodes" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE INDEX "cloud_nodes_area_idx" ON "cloud_nodes" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "cloud_nodes_owner_idx" ON "cloud_nodes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cloud_nodes_deleted_root_idx" ON "cloud_nodes" USING btree ("deleted_root_id");--> statement-breakpoint
CREATE INDEX "cloud_recents_user_idx" ON "cloud_recents" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "cloud_shares_node_idx" ON "cloud_shares" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "cloud_shares_user_idx" ON "cloud_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cloud_shares_workspace_idx" ON "cloud_shares" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_versions_node_number_idx" ON "cloud_versions" USING btree ("node_id","number");--> statement-breakpoint
CREATE INDEX "cloud_versions_workspace_idx" ON "cloud_versions" USING btree ("workspace_id");