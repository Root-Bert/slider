CREATE TABLE "todo_dependencies" (
	"todo_id" text NOT NULL,
	"blocked_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_dependencies_todo_id_blocked_by_id_pk" PRIMARY KEY("todo_id","blocked_by_id")
);
--> statement-breakpoint
ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_blocked_by_id_todos_id_fk" FOREIGN KEY ("blocked_by_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_dependencies_blocked_by_idx" ON "todo_dependencies" USING btree ("blocked_by_id");
