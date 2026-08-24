package main

import (
	"context"
	"log"

	"github.com/savior714/flashnote/internal/persistence"
)

const appVersion = "0.1.0-dev"

type AppService struct {
	store *persistence.Store
}

type RuntimeInfo struct {
	AppVersion    string `json:"appVersion"`
	DatabaseReady bool   `json:"databaseReady"`
	SQLiteVersion string `json:"sqliteVersion"`
	JournalMode   string `json:"journalMode"`
	Synchronous   int    `json:"synchronous"`
	ForeignKeys   bool   `json:"foreignKeys"`
	SchemaVersion int    `json:"schemaVersion"`
}

func NewAppService(store *persistence.Store) *AppService {
	return &AppService{store: store}
}

func (s *AppService) CreateNote() (string, string, string, int64, bool, error) {
	note, err := s.store.CreateNote(context.Background())
	if err != nil {
		return "", "", "", 0, false, err
	}
	log.Printf("FLASHNOTE_NOTE_CREATED id=%s revision=%d folder=root", note.ID, note.Revision)
	return note.ID, note.Title, note.DocumentJSON, note.Revision, true, nil
}

func (s *AppService) CreateNoteInFolder(folderID string) (string, string, string, int64, bool, error) {
	note, err := s.store.CreateNoteInFolder(context.Background(), folderID)
	if err != nil {
		return "", "", "", 0, false, err
	}
	log.Printf("FLASHNOTE_NOTE_CREATED id=%s revision=%d folder=%s", note.ID, note.Revision, folderID)
	return note.ID, note.Title, note.DocumentJSON, note.Revision, true, nil
}

func (s *AppService) CreateFolder(name string) (string, string, error) {
	folder, err := s.store.CreateFolder(context.Background(), name)
	if err != nil {
		return "", "", err
	}
	log.Printf("FLASHNOTE_FOLDER_CREATED id=%s", folder.ID)
	return folder.ID, folder.Name, nil
}

func (s *AppService) GetRuntimeInfo() (RuntimeInfo, error) {
	info, err := s.store.RuntimeInfo(context.Background())
	if err != nil {
		return RuntimeInfo{}, err
	}
	runtimeInfo := RuntimeInfo{
		AppVersion:    appVersion,
		DatabaseReady: true,
		SQLiteVersion: info.SQLiteVersion,
		JournalMode:   info.JournalMode,
		Synchronous:   info.Synchronous,
		ForeignKeys:   info.ForeignKeys,
		SchemaVersion: info.SchemaVersion,
	}
	log.Printf(
		"FLASHNOTE_RUNTIME_READY sqlite=%s journal=%s synchronous=%d foreign_keys=%t schema=%d",
		runtimeInfo.SQLiteVersion,
		runtimeInfo.JournalMode,
		runtimeInfo.Synchronous,
		runtimeInfo.ForeignKeys,
		runtimeInfo.SchemaVersion,
	)
	return runtimeInfo, nil
}

func (s *AppService) ListNotes() ([]string, []string, error) {
	summaries, err := s.store.ListNotes(context.Background())
	if err != nil {
		return nil, nil, err
	}
	ids, displayTitles := noteSummaryArrays(summaries)
	log.Printf("FLASHNOTE_NOTE_LIST count=%d", len(ids))
	return ids, displayTitles, nil
}

func (s *AppService) ListRootNotes() ([]string, []string, error) {
	summaries, err := s.store.ListRootNotes(context.Background())
	if err != nil {
		return nil, nil, err
	}
	ids, displayTitles := noteSummaryArrays(summaries)
	return ids, displayTitles, nil
}

func (s *AppService) ListFolders() ([]string, []string, error) {
	folders, err := s.store.ListFolders(context.Background())
	if err != nil {
		return nil, nil, err
	}
	ids := make([]string, 0, len(folders))
	names := make([]string, 0, len(folders))
	for _, folder := range folders {
		ids = append(ids, folder.ID)
		names = append(names, folder.Name)
	}
	return ids, names, nil
}

func (s *AppService) ListFolderNotes(folderID string) ([]string, []string, error) {
	summaries, err := s.store.ListFolderNotes(context.Background(), folderID)
	if err != nil {
		return nil, nil, err
	}
	ids, displayTitles := noteSummaryArrays(summaries)
	return ids, displayTitles, nil
}

func (s *AppService) ListTrashNotes() ([]string, []string, error) {
	summaries, err := s.store.ListTrashNotes(context.Background())
	if err != nil {
		return nil, nil, err
	}
	ids, displayTitles := noteSummaryArrays(summaries)
	return ids, displayTitles, nil
}

func (s *AppService) ListTrashFolders() ([]string, []string, error) {
	folders, err := s.store.ListTrashFolders(context.Background())
	if err != nil {
		return nil, nil, err
	}
	ids := make([]string, 0, len(folders))
	names := make([]string, 0, len(folders))
	for _, folder := range folders {
		ids = append(ids, folder.ID)
		names = append(names, folder.Name)
	}
	return ids, names, nil
}

func (s *AppService) ListTrashFolderNotes(folderID string) ([]string, []string, error) {
	summaries, err := s.store.ListTrashFolderNotes(context.Background(), folderID)
	if err != nil {
		return nil, nil, err
	}
	ids, displayTitles := noteSummaryArrays(summaries)
	return ids, displayTitles, nil
}

func (s *AppService) MoveNote(noteID string, folderID string) (bool, error) {
	if err := s.store.MoveNote(context.Background(), noteID, folderID); err != nil {
		return false, err
	}
	if folderID == "" {
		log.Printf("FLASHNOTE_NOTE_MOVED id=%s folder=root", noteID)
	} else {
		log.Printf("FLASHNOTE_NOTE_MOVED id=%s folder=%s", noteID, folderID)
	}
	return true, nil
}

func (s *AppService) MoveNoteToTrash(noteID string) (bool, error) {
	if err := s.store.MoveNoteToTrash(context.Background(), noteID); err != nil {
		return false, err
	}
	log.Printf("FLASHNOTE_NOTE_TRASHED id=%s", noteID)
	return true, nil
}

func (s *AppService) MoveFolderToTrash(folderID string) (int, error) {
	count, err := s.store.MoveFolderToTrash(context.Background(), folderID)
	if err != nil {
		return 0, err
	}
	log.Printf("FLASHNOTE_FOLDER_TRASHED id=%s notes=%d", folderID, count)
	return count, nil
}

func (s *AppService) RestoreNote(noteID string) (bool, error) {
	if err := s.store.RestoreNote(context.Background(), noteID); err != nil {
		return false, err
	}
	log.Printf("FLASHNOTE_NOTE_RESTORED id=%s", noteID)
	return true, nil
}

func (s *AppService) RestoreFolder(folderID string) (int, error) {
	count, err := s.store.RestoreFolder(context.Background(), folderID)
	if err != nil {
		return 0, err
	}
	log.Printf("FLASHNOTE_FOLDER_RESTORED id=%s notes=%d", folderID, count)
	return count, nil
}

func (s *AppService) PermanentlyDeleteNote(noteID string) (bool, error) {
	if err := s.store.PermanentlyDeleteNote(context.Background(), noteID); err != nil {
		return false, err
	}
	log.Printf("FLASHNOTE_NOTE_PERMANENTLY_DELETED id=%s", noteID)
	return true, nil
}

func (s *AppService) PermanentlyDeleteFolder(folderID string) (int, error) {
	count, err := s.store.PermanentlyDeleteFolder(context.Background(), folderID)
	if err != nil {
		return 0, err
	}
	log.Printf("FLASHNOTE_FOLDER_PERMANENTLY_DELETED id=%s notes=%d", folderID, count)
	return count, nil
}

func (s *AppService) TrashCounts() (int, int, error) {
	return s.store.TrashCounts(context.Background())
}

func (s *AppService) EmptyTrash() (int, int, error) {
	notes, folders, err := s.store.EmptyTrash(context.Background())
	if err != nil {
		return 0, 0, err
	}
	log.Printf("FLASHNOTE_TRASH_EMPTIED notes=%d folders=%d", notes, folders)
	return notes, folders, nil
}

func (s *AppService) SearchNotes(query string) ([]string, []string, []string, error) {
	results, err := s.store.SearchNotes(context.Background(), query)
	if err != nil {
		return nil, nil, nil, err
	}
	ids := make([]string, 0, len(results))
	displayTitles := make([]string, 0, len(results))
	excerpts := make([]string, 0, len(results))
	for _, result := range results {
		ids = append(ids, result.ID)
		displayTitles = append(displayTitles, result.DisplayTitle)
		excerpts = append(excerpts, result.Excerpt)
	}
	log.Printf("FLASHNOTE_NOTE_SEARCH query_len=%d count=%d", len(query), len(ids))
	return ids, displayTitles, excerpts, nil
}

func (s *AppService) OpenInitialNote() (string, string, string, int64, bool, error) {
	note, created, err := s.store.OpenInitialNote(context.Background())
	if err != nil {
		return "", "", "", 0, false, err
	}
	if created {
		log.Printf("FLASHNOTE_NOTE_CREATED id=%s revision=%d folder=root", note.ID, note.Revision)
	}
	log.Printf("FLASHNOTE_NOTE_OPEN id=%s revision=%d created=%t", note.ID, note.Revision, created)
	return note.ID, note.Title, note.DocumentJSON, note.Revision, created, nil
}

func (s *AppService) OpenNote(noteID string) (string, string, string, int64, bool, error) {
	note, err := s.store.OpenNote(context.Background(), noteID)
	if err != nil {
		return "", "", "", 0, false, err
	}
	log.Printf("FLASHNOTE_NOTE_OPEN id=%s revision=%d created=false", note.ID, note.Revision)
	return note.ID, note.Title, note.DocumentJSON, note.Revision, false, nil
}

func (s *AppService) OpenTrashNote(noteID string) (string, string, string, int64, bool, error) {
	note, err := s.store.OpenTrashNote(context.Background(), noteID)
	if err != nil {
		return "", "", "", 0, false, err
	}
	log.Printf("FLASHNOTE_TRASH_NOTE_OPEN id=%s revision=%d", note.ID, note.Revision)
	return note.ID, note.Title, note.DocumentJSON, note.Revision, false, nil
}

func (s *AppService) SaveNote(noteID string, title string, documentJSON string, expectedRevision int64) (int64, error) {
	revision, err := s.store.SaveNote(context.Background(), noteID, title, documentJSON, expectedRevision)
	if err != nil {
		return 0, err
	}
	log.Printf("FLASHNOTE_NOTE_SAVED id=%s revision=%d", noteID, revision)
	return revision, nil
}

func noteSummaryArrays(summaries []persistence.NoteSummary) ([]string, []string) {
	ids := make([]string, 0, len(summaries))
	displayTitles := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		ids = append(ids, summary.ID)
		displayTitles = append(displayTitles, summary.DisplayTitle)
	}
	return ids, displayTitles
}
