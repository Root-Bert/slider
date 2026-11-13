-- Reactions to the AI's answers (👍 / 👎 / egal), as to comments: one per account and answer.
CREATE TABLE "ai_proposal_reactions" (
	"proposal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author" jsonb NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposal_reactions_proposal_id_user_id_pk" PRIMARY KEY("proposal_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ai_proposal_reactions" ADD CONSTRAINT "ai_proposal_reactions_proposal_id_ai_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal_reactions" ADD CONSTRAINT "ai_proposal_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_proposal_reactions_user_idx" ON "ai_proposal_reactions" USING btree ("user_id");
