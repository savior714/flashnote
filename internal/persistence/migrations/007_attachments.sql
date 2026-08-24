CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/gif')),
    original_name TEXT NOT NULL DEFAULT '',
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    storage_name TEXT NOT NULL UNIQUE,
    claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE TRIGGER notes_validate_attachment_refs_insert
BEFORE INSERT ON notes
WHEN EXISTS (
    SELECT 1
    FROM json_tree(NEW.document_json) AS node
    WHERE node.key = 'attachmentId'
      AND NOT EXISTS (SELECT 1 FROM attachments WHERE id = node.value)
)
BEGIN
    SELECT RAISE(ABORT, 'document references unknown attachment');
END;

CREATE TRIGGER notes_validate_attachment_refs_update
BEFORE UPDATE OF document_json ON notes
WHEN EXISTS (
    SELECT 1
    FROM json_tree(NEW.document_json) AS node
    WHERE node.key = 'attachmentId'
      AND NOT EXISTS (SELECT 1 FROM attachments WHERE id = node.value)
)
BEGIN
    SELECT RAISE(ABORT, 'document references unknown attachment');
END;


CREATE TRIGGER notes_claim_attachment_refs_insert
AFTER INSERT ON notes
BEGIN
    UPDATE attachments
    SET claimed = 1
    WHERE id IN (
        SELECT node.value
        FROM json_tree(NEW.document_json) AS node
        WHERE node.key = 'attachmentId'
    );
END;

CREATE TRIGGER notes_claim_attachment_refs_update
AFTER UPDATE OF document_json ON notes
BEGIN
    UPDATE attachments
    SET claimed = 1
    WHERE id IN (
        SELECT node.value
        FROM json_tree(NEW.document_json) AS node
        WHERE node.key = 'attachmentId'
    );
END;
