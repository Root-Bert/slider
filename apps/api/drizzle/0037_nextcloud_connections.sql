CREATE TABLE "nextcloud_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_url" text NOT NULL,
	"login_name" text NOT NULL,
	"nc_user_id" text NOT NULL,
	"app_password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "nextcloud_connections_user_server_account_unique" UNIQUE("user_id","server_url","nc_user_id")
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "nextcloud_connection_id" text;--> statement-breakpoint
ALTER TABLE "nextcloud_connections" ADD CONSTRAINT "nextcloud_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_nextcloud_connection_id_nextcloud_connections_id_fk" FOREIGN KEY ("nextcloud_connection_id") REFERENCES "public"."nextcloud_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_nextcloud_connection_idx" ON "decks" USING btree ("nextcloud_connection_id");