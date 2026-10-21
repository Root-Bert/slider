CREATE TABLE "google_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"account" text,
	"refresh_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "google_connections_user_subject_unique" UNIQUE("user_id","subject")
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "google_connection_id" text;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_google_connection_idx" ON "decks" USING btree ("google_connection_id");