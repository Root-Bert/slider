-- How a mailbox signs in: `password` (IMAP/SMTP with its password), or `microsoft` / `google` –
-- „Mit Microsoft/Google anmelden“ (OAuth, XOAUTH2); Outlook.com, Hotmail, Live take no password.
-- Its refresh token is sealed like the password; `null` once the provider refused it (sign in anew).
ALTER TABLE "mail_accounts" ADD COLUMN "auth" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "refresh_token" text;
