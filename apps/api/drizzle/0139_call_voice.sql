-- The voice an agent speaks with in the workspace's calls (Mistral TTS, a preset's slug);
-- `null`: the first German preset of the key's account.
ALTER TABLE "workspaces" ADD COLUMN "call_voice" text;
