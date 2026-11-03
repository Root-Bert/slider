-- Per kind, the model a workspace runs the instance's key on, where the instance lets it pick one.
ALTER TABLE "workspaces" ADD COLUMN "integration_models" jsonb DEFAULT '{}'::jsonb NOT NULL;
