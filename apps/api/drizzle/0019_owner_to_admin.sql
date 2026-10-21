-- Owner and admin are one role now; who founded a workspace stays in "workspaces"."created_by".
UPDATE "workspace_members" SET "role" = 'admin' WHERE "role" = 'owner';
