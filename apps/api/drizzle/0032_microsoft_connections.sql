CREATE TABLE "microsoft_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"account" text,
	"tenant_id" text,
	"identity_subject" text,
	"refresh_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "microsoft_connections_user_subject_unique" UNIQUE("user_id","subject")
);
--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "microsoft_connection_id" text;--> statement-breakpoint
ALTER TABLE "microsoft_connections" ADD CONSTRAINT "microsoft_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "microsoft_connections_subject_idx" ON "microsoft_connections" USING btree ("subject");--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_microsoft_connection_id_microsoft_connections_id_fk" FOREIGN KEY ("microsoft_connection_id") REFERENCES "public"."microsoft_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_microsoft_connection_idx" ON "decks" USING btree ("microsoft_connection_id");--> statement-breakpoint
-- Every account's one Microsoft connection becomes its first row. The login identity of the same
-- account: by object id (Graph id = oid for work accounts), else the account's only Microsoft login.
INSERT INTO "microsoft_connections" ("id", "user_id", "subject", "account", "tenant_id", "identity_subject", "refresh_token", "created_at")
SELECT gen_random_uuid()::text, u."id", COALESCE(u."ms_subject", 'legacy:' || u."id"), u."ms_account",
	split_part(i."subject", ':', 1), i."subject", u."ms_refresh_token", now()
FROM "users" u
LEFT JOIN LATERAL (
	SELECT ui."subject" FROM "user_identities" ui
	WHERE ui."user_id" = u."id" AND ui."provider" = 'microsoft'
		AND (split_part(ui."subject", ':', 2) = u."ms_subject"
			OR (SELECT count(*) FROM "user_identities" o WHERE o."user_id" = u."id" AND o."provider" = 'microsoft') = 1)
	ORDER BY (split_part(ui."subject", ':', 2) = u."ms_subject") DESC, ui."created_at"
	LIMIT 1
) i ON true
WHERE u."ms_refresh_token" IS NOT NULL OR u."ms_subject" IS NOT NULL;--> statement-breakpoint
-- Decks that synced through Graph used exactly that connection.
UPDATE "decks" d SET "microsoft_connection_id" = c."id"
FROM "microsoft_connections" c
WHERE c."user_id" = d."owner_id" AND d."source" <> 'upload'
	AND (d."source_ref" LIKE 'drives/%' OR d."source_ref" LIKE 'items/%');--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "ms_refresh_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "ms_account";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "ms_subject";