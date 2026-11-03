-- The workspace AI's keys become the keys of every integration – AI, speech to text, photos – of the workspaces and of the instance (workspace_id null). The keys stay as they are: their sealing names the table's first name.
ALTER TABLE "workspace_ai_keys" RENAME TO "integration_keys";--> statement-breakpoint
ALTER TABLE "integration_keys" RENAME CONSTRAINT "workspace_ai_keys_pkey" TO "integration_keys_pkey";--> statement-breakpoint
ALTER TABLE "integration_keys" RENAME CONSTRAINT "workspace_ai_keys_workspace_id_workspaces_id_fk" TO "integration_keys_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "integration_keys" RENAME CONSTRAINT "workspace_ai_keys_set_by_id_users_id_fk" TO "integration_keys_set_by_id_users_id_fk";--> statement-breakpoint
ALTER INDEX "workspace_ai_keys_workspace_idx" RENAME TO "integration_keys_workspace_idx";--> statement-breakpoint
DROP INDEX "workspace_ai_keys_active_idx";--> statement-breakpoint
ALTER TABLE "integration_keys" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_keys" ADD COLUMN "kind" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_keys" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_keys_active_idx" ON "integration_keys" USING btree ("workspace_id","kind") WHERE "integration_keys"."active" AND "integration_keys"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_keys_instance_active_idx" ON "integration_keys" USING btree ("kind") WHERE "integration_keys"."active" AND "integration_keys"."workspace_id" IS NULL;
