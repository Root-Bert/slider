DROP TABLE "login_tokens" CASCADE;--> statement-breakpoint
DELETE FROM "user_identities" WHERE "provider" = 'email';--> statement-breakpoint
DELETE FROM "instance_settings" WHERE "key" IN ('SMTP_URL', 'MAIL_FROM');
