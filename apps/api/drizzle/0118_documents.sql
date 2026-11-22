CREATE TABLE "documents" (
	"node_id" text PRIMARY KEY NOT NULL,
	"edit_seq" integer DEFAULT 0 NOT NULL,
	"draft_version_id" text,
	"draft_by" text,
	"draft_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"client_edit_id" text NOT NULL,
	"seq" integer NOT NULL,
	"dropped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"parent_id" text,
	"author_id" text,
	"body" text NOT NULL,
	"anchor" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_draft_by_users_id_fk" FOREIGN KEY ("draft_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_edits" ADD CONSTRAINT "document_edits_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_parent_id_document_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_edits_client_idx" ON "document_edits" USING btree ("document_id","client_edit_id");--> statement-breakpoint
CREATE INDEX "document_comments_document_idx" ON "document_comments" USING btree ("document_id","created_at");
