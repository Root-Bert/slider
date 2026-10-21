-- Pink and lime are gone from the palette (too close to violet and green): fold them into those.
UPDATE "users" SET "color" = CASE "color" WHEN 'pink' THEN 'violet' ELSE 'green' END
  WHERE "color" IN ('pink', 'lime');
--> statement-breakpoint
UPDATE "comments" SET "author" = jsonb_set("author", '{color}',
    CASE "author"->>'color' WHEN 'pink' THEN '"violet"'::jsonb ELSE '"green"'::jsonb END)
  WHERE "author"->>'color' IN ('pink', 'lime');
--> statement-breakpoint
UPDATE "comments" SET "strokes" = (
    SELECT jsonb_agg(
      CASE s->>'color'
        WHEN 'pink' THEN jsonb_set(s, '{color}', '"violet"')
        WHEN 'lime' THEN jsonb_set(s, '{color}', '"green"')
        ELSE s
      END ORDER BY i)
    FROM jsonb_array_elements("strokes") WITH ORDINALITY AS t(s, i))
  WHERE jsonb_path_exists("strokes", '$[*] ? (@.color == "pink" || @.color == "lime")');
