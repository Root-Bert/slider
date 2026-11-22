-- „Verbindungen“ may be a plain HTTP API too: its kind, and its sign-in and description (sealed).
ALTER TABLE "cloud_connections" ADD COLUMN "kind" text DEFAULT 'mcp' NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_connections" ADD COLUMN "api" jsonb;
