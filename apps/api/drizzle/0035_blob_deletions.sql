CREATE TABLE "blob_deletions" (
	"store" text NOT NULL,
	"key" text NOT NULL,
	"prefix" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blob_deletions_store_key_pk" PRIMARY KEY("store","key")
);
