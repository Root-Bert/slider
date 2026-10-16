CREATE INDEX "comments_slide_idx" ON "comments" USING btree ("slide_id");--> statement-breakpoint
CREATE INDEX "slide_versions_slide_idx" ON "slide_versions" USING btree ("slide_id");--> statement-breakpoint
CREATE INDEX "slide_versions_image_key_idx" ON "slide_versions" USING btree ("image_key");--> statement-breakpoint
CREATE INDEX "slide_versions_thumbnail_key_idx" ON "slide_versions" USING btree ("thumbnail_key");