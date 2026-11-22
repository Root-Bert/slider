-- 0160 carried a generated `when` below 0159's: databases that had 0159 before it skipped it.
ALTER TABLE "cloud_agents" ADD COLUMN IF NOT EXISTS "named" boolean DEFAULT false NOT NULL;
