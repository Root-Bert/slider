-- There are no guests any more: old guest comments count as ordinary Slider authors.
UPDATE "comments" SET "author" = jsonb_set("author", '{type}', '"owner"') WHERE "author"->>'type' = 'guest';
