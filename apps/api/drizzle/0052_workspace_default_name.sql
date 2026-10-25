-- „Organisation“ is called „Workspace“ now: workspaces still named by default get the new default name.
UPDATE "workspaces" SET "name" = 'Mein Workspace' WHERE "name" = 'Meine Organisation';
