-- Where a workspace font came from: the deck it was embedded in (its title then); null when uploaded.
ALTER TABLE "workspace_fonts" ADD COLUMN "source_file" text;
