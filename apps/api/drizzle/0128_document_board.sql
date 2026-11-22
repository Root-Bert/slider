ALTER TABLE "deck_materials" ALTER COLUMN "deck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_materials" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "deck_materials" ADD CONSTRAINT "deck_materials_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_materials" ADD CONSTRAINT "deck_materials_owner_check" CHECK (num_nonnulls("deck_materials"."deck_id", "deck_materials"."document_id") = 1);--> statement-breakpoint
CREATE INDEX "deck_materials_document_idx" ON "deck_materials" USING btree ("document_id","created_at");--> statement-breakpoint
ALTER TABLE "deck_board_items" ALTER COLUMN "deck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_board_items" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "deck_board_items" ADD CONSTRAINT "deck_board_items_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_board_items" ADD CONSTRAINT "deck_board_items_owner_check" CHECK (num_nonnulls("deck_board_items"."deck_id", "deck_board_items"."document_id") = 1);--> statement-breakpoint
CREATE INDEX "deck_board_items_document_idx" ON "deck_board_items" USING btree ("document_id","created_at");--> statement-breakpoint
ALTER TABLE "material_questions" ALTER COLUMN "deck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "material_questions" ADD CONSTRAINT "material_questions_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_questions" ADD CONSTRAINT "material_questions_owner_check" CHECK (num_nonnulls("material_questions"."deck_id", "material_questions"."document_id") = 1);--> statement-breakpoint
CREATE INDEX "material_questions_document_idx" ON "material_questions" USING btree ("document_id","created_at");--> statement-breakpoint
ALTER TABLE "material_chats" ALTER COLUMN "deck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material_chats" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "material_chats" ADD CONSTRAINT "material_chats_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_chats" ADD CONSTRAINT "material_chats_owner_check" CHECK (num_nonnulls("material_chats"."deck_id", "material_chats"."document_id") = 1);--> statement-breakpoint
CREATE INDEX "material_chats_document_idx" ON "material_chats" USING btree ("document_id","user_id","updated_at");--> statement-breakpoint
ALTER TABLE "material_chunks" ALTER COLUMN "deck_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "material_chunks" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_document_id_cloud_nodes_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cloud_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_owner_check" CHECK (num_nonnulls("material_chunks"."deck_id", "material_chunks"."document_id") = 1);--> statement-breakpoint
CREATE INDEX "material_chunks_document_idx" ON "material_chunks" USING btree ("document_id");
