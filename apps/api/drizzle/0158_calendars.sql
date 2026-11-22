CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"title" text NOT NULL,
	"location" text NOT NULL,
	"notes" text NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"area_id" text,
	"owner_id" text,
	"parent_id" text,
	"mail_account_id" text,
	"remote_id" text,
	"name" text NOT NULL,
	"color" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_parent_id_calendars_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_mail_account_id_mail_accounts_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_calendar_idx" ON "calendar_events" USING btree ("calendar_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_range_idx" ON "calendar_events" USING btree ("workspace_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "calendars_workspace_idx" ON "calendars" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "calendars_parent_idx" ON "calendars" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_area_root_idx" ON "calendars" USING btree ("area_id") WHERE "calendars"."parent_id" IS NULL AND "calendars"."mail_account_id" IS NULL AND "calendars"."area_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_private_root_idx" ON "calendars" USING btree ("workspace_id","owner_id") WHERE "calendars"."parent_id" IS NULL AND "calendars"."mail_account_id" IS NULL AND "calendars"."area_id" IS NULL AND "calendars"."owner_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_remote_idx" ON "calendars" USING btree ("mail_account_id","remote_id") WHERE "calendars"."mail_account_id" IS NOT NULL;