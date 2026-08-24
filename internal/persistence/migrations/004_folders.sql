CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX folders_name_idx ON folders(name COLLATE NOCASE, id ASC);

ALTER TABLE notes
ADD COLUMN folder_id TEXT DEFAULT NULL REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX notes_folder_updated_idx
ON notes(folder_id, updated_at DESC, id ASC);
