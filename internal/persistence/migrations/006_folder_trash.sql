ALTER TABLE folders ADD COLUMN deleted_at TEXT;

ALTER TABLE notes
ADD COLUMN deleted_with_folder_id TEXT DEFAULT NULL
REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX folders_deleted_name_idx
ON folders(deleted_at, name COLLATE NOCASE, id ASC);

CREATE INDEX notes_deleted_with_folder_idx
ON notes(deleted_with_folder_id, deleted_at, updated_at DESC, id ASC);
