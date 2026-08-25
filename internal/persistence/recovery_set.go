package persistence

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	recoveryManifestVersion          = 1
	recoveryManifestSuffix           = ".json"
	recoveryAttachmentArchiveDirName = "attachment-bytes"
)

type recoveryAttachment struct {
	ID          string `json:"id"`
	StorageName string `json:"storageName"`
	ByteSize    int64  `json:"byteSize"`
	SHA256      string `json:"sha256"`
}

type recoveryManifest struct {
	Version          int                  `json:"version"`
	SnapshotID       string               `json:"snapshotId"`
	DatabaseFile     string               `json:"databaseFile"`
	DatabaseByteSize int64                `json:"databaseByteSize"`
	DatabaseSHA256   string               `json:"databaseSha256"`
	CreatedAt        string               `json:"createdAt"`
	Attachments      []recoveryAttachment `json:"attachments"`
}

type RecoverySnapshot struct {
	ID              string
	CreatedAt       time.Time
	AttachmentCount int
}

func recoverySnapshotID(path string) (string, error) {
	name := filepath.Base(path)
	if filepath.Ext(name) != backupFilenameSuffix || !strings.HasPrefix(name, backupFilenamePrefix) {
		return "", fmt.Errorf("invalid recovery snapshot filename %q", name)
	}
	id := strings.TrimSuffix(name, backupFilenameSuffix)
	if id == "" || filepath.Base(id) != id || strings.ContainsAny(id, `/\\`) {
		return "", fmt.Errorf("invalid recovery snapshot id %q", id)
	}
	return id, nil
}

func recoveryManifestPath(backupDir, snapshotID string) string {
	return filepath.Join(backupDir, snapshotID+recoveryManifestSuffix)
}

func recoveryDatabasePath(backupDir, snapshotID string) string {
	return filepath.Join(backupDir, snapshotID+backupFilenameSuffix)
}

func recoveryAttachmentArchiveDir(backupDir string) string {
	return filepath.Join(backupDir, recoveryAttachmentArchiveDirName)
}

func recoveryAttachmentBlobPath(backupDir, digest string) string {
	return filepath.Join(recoveryAttachmentArchiveDir(backupDir), digest)
}

func validSHA256Digest(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// RecoverySnapshotPublished is the lightweight scheduling check. A recovery
// manifest is promoted only after the database and attachment set pass full
// validation. Restore must still call ValidateRecoverySnapshot to re-check all
// digests immediately before applying the snapshot.
func RecoverySnapshotPublished(backupDir, snapshotID string) bool {
	if snapshotID == "" || filepath.Base(snapshotID) != snapshotID || strings.ContainsAny(snapshotID, `/\\`) || !strings.HasPrefix(snapshotID, backupFilenamePrefix) {
		return false
	}
	manifest, err := readRecoveryManifest(backupDir, snapshotID)
	if err != nil {
		return false
	}
	if manifest.Version != recoveryManifestVersion ||
		manifest.SnapshotID != snapshotID ||
		manifest.DatabaseFile != snapshotID+backupFilenameSuffix ||
		manifest.DatabaseByteSize <= 0 ||
		!validSHA256Digest(manifest.DatabaseSHA256) {
		return false
	}
	if _, err := os.Stat(recoveryDatabasePath(backupDir, snapshotID)); err != nil {
		return false
	}
	return true
}

func (s *Store) createRecoverySet(ctx context.Context, snapshotPath, backupDir string) error {
	snapshotID, err := recoverySnapshotID(snapshotPath)
	if err != nil {
		return err
	}
	databaseHash, databaseSize, err := hashFile(snapshotPath)
	if err != nil {
		return fmt.Errorf("hash recovery database snapshot: %w", err)
	}
	attachments, err := recoveryAttachmentsFromDatabase(snapshotPath)
	if err != nil {
		return err
	}

	archiveDir := recoveryAttachmentArchiveDir(backupDir)
	if err := os.MkdirAll(archiveDir, 0o700); err != nil {
		return fmt.Errorf("create recovery attachment archive: %w", err)
	}

	for i := range attachments {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("create recovery set cancelled: %w", err)
		}
		attachment := &attachments[i]
		if attachment.StorageName == "" || filepath.Base(attachment.StorageName) != attachment.StorageName {
			return fmt.Errorf("invalid recovery attachment storage name for %s", attachment.ID)
		}
		sourcePath := filepath.Join(s.attachmentsDir, attachment.StorageName)
		hash, size, err := hashFile(sourcePath)
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("recovery attachment bytes missing for %s", attachment.ID)
		}
		if err != nil {
			return fmt.Errorf("hash recovery attachment %s: %w", attachment.ID, err)
		}
		if size != attachment.ByteSize {
			return fmt.Errorf("recovery attachment size mismatch for %s: metadata=%d bytes=%d", attachment.ID, attachment.ByteSize, size)
		}
		attachment.SHA256 = hash
		archivePath := recoveryAttachmentBlobPath(backupDir, attachment.SHA256)
		if err := ensureArchivedAttachment(sourcePath, archivePath, size, hash); err != nil {
			return fmt.Errorf("archive recovery attachment %s: %w", attachment.ID, err)
		}
	}

	manifest := recoveryManifest{
		Version:          recoveryManifestVersion,
		SnapshotID:       snapshotID,
		DatabaseFile:     filepath.Base(snapshotPath),
		DatabaseByteSize: databaseSize,
		DatabaseSHA256:   databaseHash,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339Nano),
		Attachments:      attachments,
	}
	if err := writeRecoveryManifestAtomically(backupDir, manifest); err != nil {
		return err
	}
	if _, err := ValidateRecoverySnapshot(backupDir, snapshotID); err != nil {
		_ = os.Remove(recoveryManifestPath(backupDir, snapshotID))
		return fmt.Errorf("validate recovery set: %w", err)
	}
	return nil
}

func recoveryAttachmentsFromDatabase(snapshotPath string) ([]recoveryAttachment, error) {
	db, err := sql.Open("sqlite", sqliteFileURI(snapshotPath, true))
	if err != nil {
		return nil, fmt.Errorf("open recovery snapshot metadata: %w", err)
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT referenced.id, a.storage_name, a.byte_size
		FROM (
			SELECT DISTINCT CAST(node.value AS TEXT) AS id
			FROM notes AS n, json_tree(n.document_json) AS node
			WHERE node.key = 'attachmentId'
		) AS referenced
		LEFT JOIN attachments AS a ON a.id = referenced.id
		ORDER BY referenced.id
	`)
	if err != nil {
		return nil, fmt.Errorf("read recovery attachment metadata: %w", err)
	}
	defer rows.Close()

	attachments := make([]recoveryAttachment, 0)
	for rows.Next() {
		var id string
		var storageName sql.NullString
		var byteSize sql.NullInt64
		if err := rows.Scan(&id, &storageName, &byteSize); err != nil {
			return nil, fmt.Errorf("scan recovery attachment metadata: %w", err)
		}
		if id == "" || !storageName.Valid || !byteSize.Valid {
			return nil, fmt.Errorf("recovery snapshot references unknown attachment metadata for %q", id)
		}
		attachments = append(attachments, recoveryAttachment{
			ID:          id,
			StorageName: storageName.String,
			ByteSize:    byteSize.Int64,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recovery attachment metadata: %w", err)
	}
	return attachments, nil
}

func ensureArchivedAttachment(sourcePath, archivePath string, wantSize int64, wantHash string) error {
	if _, err := os.Stat(archivePath); err == nil {
		hash, size, hashErr := hashFile(archivePath)
		if hashErr != nil {
			return hashErr
		}
		if size != wantSize || hash != wantHash {
			return errors.New("existing archived attachment does not match immutable source bytes")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	temp, err := os.CreateTemp(filepath.Dir(archivePath), ".attachment-backup-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	promoted := false
	defer func() {
		_ = temp.Close()
		if !promoted {
			_ = os.Remove(tempPath)
		}
	}()

	if err := temp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := io.Copy(temp, source); err != nil {
		return err
	}
	if err := temp.Sync(); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if hash, size, err := hashFile(tempPath); err != nil {
		return err
	} else if size != wantSize || hash != wantHash {
		return errors.New("staged archived attachment does not match source bytes")
	}
	if err := os.Rename(tempPath, archivePath); err != nil {
		return err
	}
	promoted = true
	return nil
}

func hashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()

	hasher := sha256.New()
	size, err := io.Copy(hasher, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), size, nil
}

func writeRecoveryManifestAtomically(backupDir string, manifest recoveryManifest) error {
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encode recovery manifest: %w", err)
	}
	encoded = append(encoded, '\n')

	temp, err := os.CreateTemp(backupDir, ".flashnote-manifest-*.tmp")
	if err != nil {
		return fmt.Errorf("create recovery manifest staging file: %w", err)
	}
	tempPath := temp.Name()
	promoted := false
	defer func() {
		_ = temp.Close()
		if !promoted {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0o600); err != nil {
		return fmt.Errorf("secure recovery manifest: %w", err)
	}
	if _, err := temp.Write(encoded); err != nil {
		return fmt.Errorf("write recovery manifest: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("sync recovery manifest: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close recovery manifest: %w", err)
	}
	if err := os.Rename(tempPath, recoveryManifestPath(backupDir, manifest.SnapshotID)); err != nil {
		return fmt.Errorf("promote recovery manifest: %w", err)
	}
	promoted = true
	return nil
}

func readRecoveryManifest(backupDir, snapshotID string) (recoveryManifest, error) {
	path := recoveryManifestPath(backupDir, snapshotID)
	encoded, err := os.ReadFile(path)
	if err != nil {
		return recoveryManifest{}, fmt.Errorf("read recovery manifest: %w", err)
	}
	var manifest recoveryManifest
	if err := json.Unmarshal(encoded, &manifest); err != nil {
		return recoveryManifest{}, fmt.Errorf("decode recovery manifest: %w", err)
	}
	return manifest, nil
}

func ValidateRecoverySnapshot(backupDir, snapshotID string) (RecoverySnapshot, error) {
	if snapshotID == "" || filepath.Base(snapshotID) != snapshotID || strings.ContainsAny(snapshotID, `/\\`) || !strings.HasPrefix(snapshotID, backupFilenamePrefix) {
		return RecoverySnapshot{}, fmt.Errorf("invalid recovery snapshot id %q", snapshotID)
	}
	manifest, err := readRecoveryManifest(backupDir, snapshotID)
	if err != nil {
		return RecoverySnapshot{}, err
	}
	if manifest.Version != recoveryManifestVersion || manifest.SnapshotID != snapshotID || manifest.DatabaseFile != snapshotID+backupFilenameSuffix {
		return RecoverySnapshot{}, errors.New("recovery manifest identity mismatch")
	}
	if manifest.DatabaseByteSize <= 0 || !validSHA256Digest(manifest.DatabaseSHA256) {
		return RecoverySnapshot{}, errors.New("recovery manifest database digest is invalid")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, manifest.CreatedAt)
	if err != nil {
		return RecoverySnapshot{}, fmt.Errorf("invalid recovery manifest timestamp: %w", err)
	}

	databasePath := recoveryDatabasePath(backupDir, snapshotID)
	databaseHash, databaseSize, err := hashFile(databasePath)
	if err != nil {
		return RecoverySnapshot{}, fmt.Errorf("read recovery database snapshot: %w", err)
	}
	if databaseSize != manifest.DatabaseByteSize || databaseHash != manifest.DatabaseSHA256 {
		return RecoverySnapshot{}, errors.New("recovery database digest does not match manifest")
	}
	if err := validateBackupDatabase(databasePath); err != nil {
		return RecoverySnapshot{}, err
	}
	expected, err := recoveryAttachmentsFromDatabase(databasePath)
	if err != nil {
		return RecoverySnapshot{}, err
	}
	if len(expected) != len(manifest.Attachments) {
		return RecoverySnapshot{}, errors.New("recovery manifest attachment set does not match database snapshot")
	}

	for i := range expected {
		want := expected[i]
		got := manifest.Attachments[i]
		if got.ID != want.ID || got.StorageName != want.StorageName || got.ByteSize != want.ByteSize || !validSHA256Digest(got.SHA256) {
			return RecoverySnapshot{}, fmt.Errorf("recovery manifest attachment identity mismatch for %s", want.ID)
		}
		if got.StorageName == "" || filepath.Base(got.StorageName) != got.StorageName {
			return RecoverySnapshot{}, fmt.Errorf("invalid archived attachment storage name for %s", got.ID)
		}
		hash, size, err := hashFile(recoveryAttachmentBlobPath(backupDir, got.SHA256))
		if err != nil {
			return RecoverySnapshot{}, fmt.Errorf("read archived attachment %s: %w", got.ID, err)
		}
		if size != got.ByteSize || hash != got.SHA256 {
			return RecoverySnapshot{}, fmt.Errorf("archived attachment verification failed for %s", got.ID)
		}
	}

	return RecoverySnapshot{ID: snapshotID, CreatedAt: createdAt, AttachmentCount: len(manifest.Attachments)}, nil
}

func pruneRecoveryAttachmentArchive(backupDir string) error {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return fmt.Errorf("read backup directory for recovery attachment retention: %w", err)
	}

	retainedDigests := make(map[string]struct{})
	manifestNames := make([]string, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), backupFilenamePrefix) || !strings.HasSuffix(entry.Name(), recoveryManifestSuffix) {
			continue
		}
		manifestNames = append(manifestNames, entry.Name())
	}
	sort.Strings(manifestNames)
	for _, name := range manifestNames {
		snapshotID := strings.TrimSuffix(name, recoveryManifestSuffix)
		manifest, err := readRecoveryManifest(backupDir, snapshotID)
		if err != nil {
			return fmt.Errorf("read retained recovery manifest %q before attachment GC: %w", name, err)
		}
		if manifest.Version != recoveryManifestVersion || manifest.SnapshotID != snapshotID {
			return fmt.Errorf("retained recovery manifest %q has invalid identity", name)
		}
		for _, attachment := range manifest.Attachments {
			if !validSHA256Digest(attachment.SHA256) {
				return fmt.Errorf("retained recovery manifest %q has invalid attachment digest", name)
			}
			retainedDigests[attachment.SHA256] = struct{}{}
		}
	}

	archiveDir := recoveryAttachmentArchiveDir(backupDir)
	archiveEntries, err := os.ReadDir(archiveDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read recovery attachment archive: %w", err)
	}
	for _, entry := range archiveEntries {
		if entry.IsDir() {
			continue
		}
		if _, keep := retainedDigests[entry.Name()]; keep {
			continue
		}
		if err := os.Remove(filepath.Join(archiveDir, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove unreferenced recovery attachment blob %q: %w", entry.Name(), err)
		}
	}
	return nil
}
