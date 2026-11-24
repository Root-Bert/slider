-- A mail's List-Unsubscribe (encrypted): how to leave a newsletter in one go.
ALTER TABLE "mail_messages" ADD COLUMN "unsubscribe" jsonb;