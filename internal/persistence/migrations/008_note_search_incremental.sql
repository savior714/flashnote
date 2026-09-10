-- Steady-state note mutations now maintain note_search incrementally inside the
-- same Go-owned transaction that mutates notes (see indexNoteSearchTx and its
-- callers). Global invalidation on every write is no longer the write path, so
-- drop the invalidation triggers. A full rebuild remains for bootstrap, index
-- schema/version transition, and explicitly detected invalid state via
-- ensureSearchIndex, which still gates on search_index_version.
DROP TRIGGER IF EXISTS note_search_invalidate_insert;
DROP TRIGGER IF EXISTS note_search_invalidate_update;
DROP TRIGGER IF EXISTS note_search_invalidate_delete;
DROP TRIGGER IF EXISTS note_search_invalidate_trash;
