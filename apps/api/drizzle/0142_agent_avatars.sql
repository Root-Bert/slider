-- How a workspace's agents look, picked by its admins: `flowers` („Glaze Flowers“) as before, or
-- `cameo` (DiceBear's „Cameo“). Drawn in the browser from the agent's id.
ALTER TABLE "workspaces" ADD COLUMN "agent_avatars" text DEFAULT 'flowers' NOT NULL;
