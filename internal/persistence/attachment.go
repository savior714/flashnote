package persistence

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"

	"github.com/savior714/flashnote/internal/document"
)

const (
	maxImageBytes      = 32 << 20
	maxImageDimension  = 20000
	maxImagePixelCount = 100_000_000
)

var ErrAttachmentNotFound = errors.New("attachment not found")

type Attachment struct {
	ID           string
	MediaType    string
	OriginalName string
	ByteSize     int64
	Width        int
	Height       int
	StorageName  string
}

type OpenAttachment struct {
	File      *os.File
	MediaType string
	ByteSize  int64
}

func (s *Store) IngestImage(ctx context.Context, content []byte, originalName string) (Attachment, error) {
	s.attachmentMu.Lock()
	defer s.attachmentMu.Unlock()

	if len(content) == 0 {
		return Attachment{}, errors.New("image is empty")
	}
	if len(content) > maxImageBytes {
		return Attachment{}, fmt.Errorf("image exceeds Flashnote's %d MiB safety limit", maxImageBytes>>20)
	}

	config, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil {
		return Attachment{}, errors.New("unsupported or invalid image; Flashnote supports PNG, JPEG, and GIF")
	}
	mediaType, extension, ok := supportedImageFormat(format)
	if !ok {
		return Attachment{}, fmt.Errorf("unsupported image format %q; Flashnote supports PNG, JPEG, and GIF", format)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImageDimension || config.Height > maxImageDimension || int64(config.Width)*int64(config.Height) > maxImagePixelCount {
		return Attachment{}, errors.New("image dimensions exceed Flashnote's safety limit")
	}

	id, err := newNoteID()
	if err != nil {
		return Attachment{}, fmt.Errorf("generate attachment id: %w", err)
	}
	storageName := id + extension
	finalPath := filepath.Join(s.attachmentsDir, storageName)

	tempFile, err := os.CreateTemp(s.attachmentsDir, ".ingest-*")
	if err != nil {
		return Attachment{}, fmt.Errorf("create attachment staging file: %w", err)
	}
	tempPath := tempFile.Name()
	promoted := false
	defer func() {
		_ = tempFile.Close()
		if !promoted {
			_ = os.Remove(tempPath)
		}
	}()

	if err := tempFile.Chmod(0o600); err != nil {
		return Attachment{}, fmt.Errorf("secure attachment staging file: %w", err)
	}
	if _, err := tempFile.Write(content); err != nil {
		return Attachment{}, fmt.Errorf("write attachment staging file: %w", err)
	}
	if err := tempFile.Sync(); err != nil {
		return Attachment{}, fmt.Errorf("sync attachment staging file: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return Attachment{}, fmt.Errorf("close attachment staging file: %w", err)
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return Attachment{}, fmt.Errorf("promote attachment: %w", err)
	}
	promoted = true

	attachment := Attachment{
		ID:           id,
		MediaType:    mediaType,
		OriginalName: normalizeOriginalName(originalName),
		ByteSize:     int64(len(content)),
		Width:        config.Width,
		Height:       config.Height,
		StorageName:  storageName,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO attachments(id, media_type, original_name, byte_size, width, height, storage_name, claimed, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%d %H:%M:%f', 'now'))
	`, attachment.ID, attachment.MediaType, attachment.OriginalName, attachment.ByteSize, attachment.Width, attachment.Height, attachment.StorageName); err != nil {
		_ = os.Remove(finalPath)
		return Attachment{}, fmt.Errorf("record attachment metadata: %w", err)
	}
	return attachment, nil
}

func supportedImageFormat(format string) (mediaType, extension string, ok bool) {
	switch strings.ToLower(format) {
	case "png":
		return "image/png", ".png", true
	case "jpeg":
		return "image/jpeg", ".jpg", true
	case "gif":
		return "image/gif", ".gif", true
	default:
		return "", "", false
	}
}

func normalizeOriginalName(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	runes := []rune(name)
	if len(runes) > 255 {
		name = string(runes[:255])
	}
	return name
}

func (s *Store) OpenAttachment(ctx context.Context, attachmentID string) (OpenAttachment, error) {
	if attachmentID == "" || strings.ContainsAny(attachmentID, `/\\`) {
		return OpenAttachment{}, fmt.Errorf("%w: invalid id", ErrAttachmentNotFound)
	}

	var storageName, mediaType string
	var byteSize int64
	err := s.db.QueryRowContext(ctx, `
		SELECT storage_name, media_type, byte_size
		FROM attachments
		WHERE id = ?
	`, attachmentID).Scan(&storageName, &mediaType, &byteSize)
	if errors.Is(err, sql.ErrNoRows) {
		return OpenAttachment{}, fmt.Errorf("%w: %s", ErrAttachmentNotFound, attachmentID)
	}
	if err != nil {
		return OpenAttachment{}, fmt.Errorf("load attachment metadata: %w", err)
	}
	if storageName == "" || filepath.Base(storageName) != storageName {
		return OpenAttachment{}, fmt.Errorf("invalid stored attachment name for %s", attachmentID)
	}

	file, err := os.Open(filepath.Join(s.attachmentsDir, storageName))
	if errors.Is(err, os.ErrNotExist) {
		return OpenAttachment{}, fmt.Errorf("%w: bytes missing for %s", ErrAttachmentNotFound, attachmentID)
	}
	if err != nil {
		return OpenAttachment{}, fmt.Errorf("open attachment bytes: %w", err)
	}
	return OpenAttachment{File: file, MediaType: mediaType, ByteSize: byteSize}, nil
}

func (s *Store) ValidateDocumentAttachments(ctx context.Context, documentJSON string) error {
	ids, err := document.AttachmentIDs(documentJSON)
	if err != nil {
		return err
	}
	for _, id := range ids {
		opened, err := s.OpenAttachment(ctx, id)
		if err != nil {
			return err
		}
		if err := opened.File.Close(); err != nil {
			return fmt.Errorf("close attachment %s after validation: %w", id, err)
		}
	}
	return nil
}

// ReconcileStoredAttachments removes metadata and bytes that are no longer referenced by any persisted note.
// includePending is true only at startup, when no in-memory draft can still be claiming a newly ingested image.
func (s *Store) ReconcileStoredAttachments(ctx context.Context, includePending bool) error {
	s.attachmentMu.Lock()
	defer s.attachmentMu.Unlock()

	referenced := make(map[string]struct{})
	rows, err := s.db.QueryContext(ctx, `SELECT document_json FROM notes`)
	if err != nil {
		return fmt.Errorf("list documents for attachment reconciliation: %w", err)
	}
	for rows.Next() {
		var documentJSON string
		if err := rows.Scan(&documentJSON); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan document for attachment reconciliation: %w", err)
		}
		ids, err := document.AttachmentIDs(documentJSON)
		if err != nil {
			_ = rows.Close()
			return fmt.Errorf("read document attachment references: %w", err)
		}
		for _, id := range ids {
			referenced[id] = struct{}{}
		}
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close attachment reconciliation documents: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate attachment reconciliation documents: %w", err)
	}

	metadataRows, err := s.db.QueryContext(ctx, `SELECT id, storage_name, claimed FROM attachments`)
	if err != nil {
		return fmt.Errorf("list attachment metadata: %w", err)
	}
	type staleAttachment struct {
		id          string
		storageName string
	}
	stale := make([]staleAttachment, 0)
	knownStorage := make(map[string]struct{})
	for metadataRows.Next() {
		var id, storageName string
		var claimed bool
		if err := metadataRows.Scan(&id, &storageName, &claimed); err != nil {
			_ = metadataRows.Close()
			return fmt.Errorf("scan attachment metadata: %w", err)
		}
		if _, ok := referenced[id]; ok || (!claimed && !includePending) {
			knownStorage[storageName] = struct{}{}
			continue
		}
		stale = append(stale, staleAttachment{id: id, storageName: storageName})
	}
	if err := metadataRows.Close(); err != nil {
		return fmt.Errorf("close attachment metadata rows: %w", err)
	}
	if err := metadataRows.Err(); err != nil {
		return fmt.Errorf("iterate attachment metadata: %w", err)
	}

	if len(stale) > 0 {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin attachment reconciliation: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		for _, attachment := range stale {
			if _, err := tx.ExecContext(ctx, `DELETE FROM attachments WHERE id = ?`, attachment.id); err != nil {
				return fmt.Errorf("delete stale attachment metadata: %w", err)
			}
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit attachment reconciliation: %w", err)
		}
	}

	for _, attachment := range stale {
		_ = os.Remove(filepath.Join(s.attachmentsDir, attachment.storageName))
	}
	return s.removeUntrackedAttachmentFiles(knownStorage)
}

func (s *Store) removeUntrackedAttachmentFiles(knownStorage map[string]struct{}) error {
	entries, err := os.ReadDir(s.attachmentsDir)
	if err != nil {
		return fmt.Errorf("read attachments directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if _, ok := knownStorage[name]; ok {
			continue
		}
		if err := os.Remove(filepath.Join(s.attachmentsDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove untracked attachment %s: %w", name, err)
		}
	}
	return nil
}
