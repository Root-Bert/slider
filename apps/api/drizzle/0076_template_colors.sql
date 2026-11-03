ALTER TABLE "decks" ADD COLUMN "custom_colors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_masters" ADD COLUMN "colors" jsonb DEFAULT '[]'::jsonb NOT NULL;