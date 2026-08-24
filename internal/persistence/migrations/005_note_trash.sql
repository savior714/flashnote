ALTER TABLE notes ADD COLUMN deleted_at TEXT;

CREATE INDEX notes_deleted_updated_idx
ON notes(deleted_at, updated_at DESC, id ASC);

CREATE TRIGGER note_search_invalidate_trash
AFTER UPDATE OF deleted_at ON notes
BEGIN
    DELETE FROM app_meta WHERE key = 'search_index_version';
END;
