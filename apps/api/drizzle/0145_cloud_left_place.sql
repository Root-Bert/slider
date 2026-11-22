-- Where a file or folder lay before it last moved (area, owner, folder), and where something gone
-- for good lay: a computer keeping a copy is told to drop it only if it could see it there.
ALTER TABLE "cloud_nodes" ADD COLUMN "left_area_id" text;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD COLUMN "left_owner_id" text;--> statement-breakpoint
ALTER TABLE "cloud_nodes" ADD COLUMN "left_parent_id" text;--> statement-breakpoint
ALTER TABLE "cloud_removed" ADD COLUMN "area_id" text;--> statement-breakpoint
ALTER TABLE "cloud_removed" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "cloud_removed" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "cloud_removed" ADD COLUMN "place_known" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE FUNCTION cloud_nodes_left() RETURNS trigger AS $$
BEGIN
	IF OLD.area_id IS DISTINCT FROM NEW.area_id
		OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
		OR OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
		NEW.left_area_id = OLD.area_id;
		NEW.left_owner_id = OLD.owner_id;
		NEW.left_parent_id = OLD.parent_id;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "cloud_nodes_left" BEFORE UPDATE OF "area_id", "owner_id", "parent_id" ON "cloud_nodes" FOR EACH ROW EXECUTE FUNCTION cloud_nodes_left();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cloud_nodes_removed() RETURNS trigger AS $$
BEGIN
	INSERT INTO cloud_removed (node_id, workspace_id, removed_at, area_id, owner_id, parent_id, place_known)
	VALUES (OLD.id, OLD.workspace_id, clock_timestamp(), OLD.area_id, OLD.owner_id, OLD.parent_id, true)
	ON CONFLICT (node_id) DO NOTHING;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
