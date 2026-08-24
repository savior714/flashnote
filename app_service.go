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
