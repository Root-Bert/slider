ALTER TABLE "cloud_agents" ADD COLUMN "area_id" text;--> statement-breakpoint
ALTER TABLE "cloud_agents" ADD CONSTRAINT "cloud_agents_area_id_cloud_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."cloud_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_agents_area_idx" ON "cloud_agents" USING btree ("area_id");
