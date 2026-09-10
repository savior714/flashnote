-- Sidebar/library projection: durable display title owned by the notes row.
--
-- Sidebar summaries previously loaded and parsed every note's full
-- document_json on each refresh to derive display titles. The derivation is
-- now performed once at write time and stored alongside the row, so the
-- canonical sidebar projection reads small durable columns without touching
-- document bodies. The Go write path (create/save) and the startup backfill
-- below are the only writers; title/document remain the input authority and
-- display_title is their projection, never a competing authority.
ALTER TABLE notes ADD COLUMN display_title TEXT NOT NULL DEFAULT '';
