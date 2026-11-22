ALTER TABLE "cloud_areas" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "cloud_areas" ADD CONSTRAINT "cloud_areas_parent_id_cloud_areas_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cloud_areas"("id") ON DELETE cascade ON UPDATE no action;
