CREATE VIRTUAL TABLE note_search USING fts5(
    note_id UNINDEXED,
    explicit_title,
    display_title,
    body_text,
    tokenize = 'unicode61'
);

CREATE TRIGGER note_search_invalidate_insert
AFTER INSERT ON notes
BEGIN
    DELETE FROM app_meta WHERE key = 'search_index_version';
END;

CREATE TRIGGER note_search_invalidate_update
AFTER UPDATE OF title, document_json ON notes
BEGIN
    DELETE FROM app_meta WHERE key = 'search_index_version';
END;

CREATE TRIGGER note_search_invalidate_delete
AFTER DELETE ON notes
BEGIN
    DELETE FROM app_meta WHERE key = 'search_index_version';
END;
