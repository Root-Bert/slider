CREATE TABLE "deck_board_items" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"author" jsonb NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"url" text,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_id" text NOT NULL,
	"author" jsonb NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"preview_key" text,
	"sha256" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"expanded" boolean DEFAULT false NOT NULL,
	"read_state" text DEFAULT 'none' NOT NULL,
	"summary" text,
	"pages" integer,
	"sheets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_chunks" (
	"material_id" text NOT NULL,
	"deck_id" text NOT NULL,
	"seq" integer NOT NULL,
	"page" integer,
	"sheet" text,
	"text" text NOT NULL,
	CONSTRAINT "material_chunks_material_id_seq_pk" PRIMARY KEY("material_id","seq")
);
--> statement-breakpoint
ALTER TABLE "deck_board_items" ADD CONSTRAINT "deck_board_items_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_materials" ADD CONSTRAINT "deck_materials_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_material_id_deck_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."deck_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_board_items_deck_idx" ON "deck_board_items" USING btree ("deck_id","created_at");--> statement-breakpoint
CREATE INDEX "deck_materials_deck_idx" ON "deck_materials" USING btree ("deck_id","created_at");--> statement-breakpoint
CREATE INDEX "material_chunks_deck_idx" ON "material_chunks" USING btree ("deck_id");