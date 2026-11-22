-- An agent writes along in calls and sends notes afterwards – on unless the admins turn it off.
ALTER TABLE "workspaces" ADD COLUMN "call_notes" boolean DEFAULT true NOT NULL;
