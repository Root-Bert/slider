ALTER TABLE "cloud_nodes" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "cloud_nodes_changed_idx" ON "cloud_nodes" USING btree ("workspace_id","changed_at","id");--> statement-breakpoint
CREATE TABLE "cloud_removed" (
	"node_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cloud_removed_workspace_idx" ON "cloud_removed" USING btree ("workspace_id","removed_at");--> statement-breakpoint
CREATE FUNCTION cloud_nodes_touch() RETURNS trigger AS $$
BEGIN
	NEW.changed_at = clock_timestamp();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "cloud_nodes_touch_insert" BEFORE INSERT ON "cloud_nodes" FOR EACH ROW EXECUTE FUNCTION cloud_nodes_touch();--> statement-breakpoint
CREATE TRIGGER "cloud_nodes_touch_update" BEFORE UPDATE OF "name", "parent_id", "area_id", "owner_id", "current_version_id", "size_bytes", "deleted_at", "color" ON "cloud_nodes" FOR EACH ROW EXECUTE FUNCTION cloud_nodes_touch();--> statement-breakpoint
CREATE FUNCTION cloud_nodes_removed() RETURNS trigger AS $$
BEGIN
	INSERT INTO cloud_removed (node_id, workspace_id, removed_at)
	VALUES (OLD.id, OLD.workspace_id, clock_timestamp())
	ON CONFLICT (node_id) DO NOTHING;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "cloud_nodes_removed" AFTER DELETE ON "cloud_nodes" FOR EACH ROW EXECUTE FUNCTION cloud_nodes_removed();
