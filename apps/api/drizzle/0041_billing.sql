CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "files_bytes" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_owner_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_transfer_to_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_transfer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "downgrade_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "downgrade_reason" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "downgrade_notices" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_billing_owner_id_users_id_fk" FOREIGN KEY ("billing_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_billing_transfer_to_id_users_id_fk" FOREIGN KEY ("billing_transfer_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");--> statement-breakpoint
UPDATE "workspaces" w SET "billing_owner_id" = coalesce(
  (SELECT m."user_id" FROM "workspace_members" m WHERE m."workspace_id" = w."id" AND m."user_id" = w."created_by" AND m."role" = 'admin'),
  (SELECT m."user_id" FROM "workspace_members" m WHERE m."workspace_id" = w."id" AND m."role" = 'admin' ORDER BY m."created_at", m."user_id" LIMIT 1)
);
