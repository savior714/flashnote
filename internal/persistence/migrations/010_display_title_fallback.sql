ALTER TABLE notes ADD COLUMN display_title_is_fallback INTEGER CHECK (display_title_is_fallback IN (0, 1) OR display_title_is_fallback IS NULL);
