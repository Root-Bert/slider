-- Repairs databases that skipped 0126_reader and 0160_agent_named: their journal `when` lay
-- before an earlier hand-written entry's, and drizzle applies only what is newer than the last
-- one applied. Each step only where it is missing, so a database that has them is untouched.
DO $$ BEGIN
  IF to_regclass('public.pdf_comments') IS NULL THEN
    CREATE TABLE "pdf_ai_proposals" (
    	"id" text PRIMARY KEY NOT NULL,
    	"pdf_id" text NOT NULL,
    	"comment_id" text NOT NULL,
    	"created_by" text,
    	"status" text DEFAULT 'running' NOT NULL,
    	"summary" text DEFAULT '' NOT NULL,
    	"error" text,
    	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
    	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "pdf_comments" (
    	"id" text PRIMARY KEY NOT NULL,
    	"pdf_id" text NOT NULL,
    	"parent_id" text,
    	"author_id" text,
    	"body" text NOT NULL,
    	"anchor" jsonb,
    	"status" text DEFAULT 'open' NOT NULL,
    	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
    	"resolved_by" text,
    	"resolved_at" timestamp with time zone,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
    	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "pdf_marks" (
    	"pdf_id" text NOT NULL,
    	"id" text NOT NULL,
    	"body" jsonb NOT NULL,
    	"author_id" text,
    	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    	CONSTRAINT "pdf_marks_pdf_id_id_pk" PRIMARY KEY("pdf_id","id")
    );
    CREATE TABLE "reader_signatures" (
    	"id" text PRIMARY KEY NOT NULL,
    	"user_id" text NOT NULL,
    	"image" text NOT NULL,
    	"width" integer NOT NULL,
    	"height" integer NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "pdf_ai_proposals" ADD CONSTRAINT "pdf_ai_proposals_pdf_id_cloud_nodes_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "pdf_ai_proposals" ADD CONSTRAINT "pdf_ai_proposals_comment_id_pdf_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."pdf_comments"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "pdf_ai_proposals" ADD CONSTRAINT "pdf_ai_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "pdf_comments" ADD CONSTRAINT "pdf_comments_pdf_id_cloud_nodes_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "pdf_comments" ADD CONSTRAINT "pdf_comments_parent_id_pdf_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pdf_comments"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "pdf_comments" ADD CONSTRAINT "pdf_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "pdf_comments" ADD CONSTRAINT "pdf_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "pdf_marks" ADD CONSTRAINT "pdf_marks_pdf_id_cloud_nodes_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "pdf_marks" ADD CONSTRAINT "pdf_marks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "reader_signatures" ADD CONSTRAINT "reader_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    CREATE INDEX "pdf_ai_proposals_pdf_idx" ON "pdf_ai_proposals" USING btree ("pdf_id","created_at");
    CREATE INDEX "pdf_comments_pdf_idx" ON "pdf_comments" USING btree ("pdf_id","created_at");
    CREATE INDEX "reader_signatures_user_idx" ON "reader_signatures" USING btree ("user_id","created_at");
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD COLUMN IF NOT EXISTS "named" boolean DEFAULT false NOT NULL;
