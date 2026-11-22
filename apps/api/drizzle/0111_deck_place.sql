ALTER TABLE "decks" ADD COLUMN "cloud_node_id" text;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_cloud_node_id_cloud_nodes_id_fk" FOREIGN KEY ("cloud_node_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decks_cloud_node_idx" ON "decks" USING btree ("cloud_node_id");
