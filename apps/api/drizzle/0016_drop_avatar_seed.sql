ALTER TABLE "users" DROP COLUMN "avatar_seed";--> statement-breakpoint
UPDATE "comments" SET "author" = "author" - 'avatarSeed' WHERE "author" ? 'avatarSeed';
