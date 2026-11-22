-- Reactions to a text document's comments (👍 / 👎 / egal), as `comment_reactions`: one per account and comment.
CREATE TABLE "document_comment_reactions" (
	"comment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author" jsonb NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_comment_reactions_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "document_comment_reactions" ADD CONSTRAINT "document_comment_reactions_comment_id_document_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."document_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comment_reactions" ADD CONSTRAINT "document_comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_comment_reactions_user_idx" ON "document_comment_reactions" USING btree ("user_id");
