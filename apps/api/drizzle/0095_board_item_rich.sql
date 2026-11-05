-- A sticker's rich text (Lexical's state, sealed); `text` keeps it as Markdown for the AI and search.
ALTER TABLE "deck_board_items" ADD COLUMN "rich" jsonb;
