CREATE TABLE "document_ai_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"error" text,
	"undo" jsonb,
	"redo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_ai_proposals" ADD CONSTRAINT "document_ai_proposals_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ai_proposals" ADD CONSTRAINT "document_ai_proposals_comment_id_document_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."document_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ai_proposals" ADD CONSTRAINT "document_ai_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_ai_proposals_document_idx" ON "document_ai_proposals" USING btree ("document_id","created_at");
