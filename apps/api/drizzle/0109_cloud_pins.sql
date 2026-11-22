CREATE TABLE "cloud_pins" (
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_pins_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "cloud_pins" ADD CONSTRAINT "cloud_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_pins" ADD CONSTRAINT "cloud_pins_node_id_cloud_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;
