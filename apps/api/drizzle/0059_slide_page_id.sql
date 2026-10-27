ALTER TABLE "slides" ADD COLUMN "page_id" text;--> statement-breakpoint
CREATE INDEX "slides_page_idx" ON "slides" USING btree ("deck_id","page_id");