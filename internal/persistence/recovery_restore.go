package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// MaterializeRecoverySnapshot reconstructs one validated recovery set into a
// new library root. The target must not already exist: this primitive never
// replaces the live Flashnote library in place.
func MaterializeRecoverySnapshot(ctx context.Context, backupDir, snapshotID, targetRoot string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("materialize recovery snapshot: %w", err)
	}
	if _, err := ValidateRecoverySnapshot(backupDir, snapshotID); err != nil {
		return "", fmt.Errorf("materialize recovery snapshot: %w", err)
	}
	manifest, err := readRecoveryManifest(backupDir, snapshotID)
	if err != nil {
		return "", fmt.Errorf("materialize recovery snapshot: %w", err)
	}
	if targetRoot == "" {
		return "", errors.New("materialize recovery snapshot: target root is required")
	}
	targetRoot = filepath.Clean(targetRoot)
	if _, err := os.Lstat(targetRoot); err == nil {
		return "", fmt.Errorf("materialize recovery snapshot: target already exists: %s", targetRoot)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("materialize recovery snapshot: inspect target: %w", err)
	}

	parent := filepath.Dir(targetRoot)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", fmt.Errorf("materialize recovery snapshot: create target parent: %w", err)
	}
	stagingRoot, err := os.MkdirTemp(parent, ".flashnote-restore-*")
	if err != nil {
		return "", fmt.Errorf("materialize recovery snapshot: create staging library: %w", err)
	}
	promoted := false
	defer func() {
		if !promoted {
			_ = os.RemoveAll(stagingRoot)
		}
	}()

	stagingDatabase := filepath.Join(stagingRoot, "flashnote.db")
	if err := copyRecoveryFile(
		ctx,
		recoveryDatabasePath(backupDir, snapshotID),
		stagingDatabase,
		manifest.DatabaseByteSize,
		manifest.DatabaseSHA256,
	); err != nil {
		return "", fmt.Errorf("materialize recovery database: %w", err)
	}

	stagingAttachments := filepath.Join(stagingRoot, "attachments")
	if err := os.Mkdir(stagingAttachments, 0o700); err != nil {
		return "", fmt.Errorf("materialize recovery attachments directory: %w", err)
	}
	for _, attachment := range manifest.Attachments {
		if err := ctx.Err(); err != nil {
			return "", fmt.Errorf("materialize recovery attachment %s: %w", attachment.ID, err)
		}
		if attachment.StorageName == "" || filepath.Base(attachment.StorageName) != attachment.StorageName || !validSHA256Digest(attachment.SHA256) {
			return "", fmt.Errorf("materialize recovery attachment %s: invalid manifest identity", attachment.ID)
		}
		if err := copyRecoveryFile(
			ctx,
			recoveryAttachmentBlobPath(backupDir, attachment.SHA256),
			filepath.Join(stagingAttachments, attachment.StorageName),
			attachment.ByteSize,
			attachment.SHA256,
		); err != nil {
			return "", fmt.Errorf("materialize recovery attachment %s: %w", attachment.ID, err)
		}
	}

	if err := validateMaterializedRecovery(stagingDatabase, stagingAttachments, manifest); err != nil {
		return "", fmt.Errorf("validate materialized recovery: %w", err)
	}
	if _, err := ValidateRecoverySnapshot(backupDir, snapshotID); err != nil {
		return "", fmt.Errorf("revalidate source recovery set before promotion: %w", err)
	}
	if err := os.Rename(stagingRoot, targetRoot); err != nil {
		return "", fmt.Errorf("promote materialized recovery library: %w", err)
	}
	promoted = true
	return filepath.Join(targetRoot, "flashnote.db"), nil
}

func copyRecoveryFile(ctx context.Context, sourcePath, destinationPath string, wantSize int64, wantDigest string) error {
	if wantSize <= 0 || !validSHA256Digest(wantDigest) {
		return errors.New("invalid recovery file integrity metadata")
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	destination, err := os.OpenFile(destinationPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		_ = destination.Close()
		if !completed {
			_ = os.Remove(destinationPath)
		}
	}()

	hasher := sha256.New()
	buffer := make([]byte, 256<<10)
	var copied int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := source.Read(buffer)
		if n > 0 {
			written, writeErr := destination.Write(buffer[:n])
			if writeErr != nil {
				return writeErr
			}
			if written != n {
				return io.ErrShortWrite
			}
			if _, err := hasher.Write(buffer[:n]); err != nil {
				return err
			}
			copied += int64(n)
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if copied != wantSize || hex.EncodeToString(hasher.Sum(nil)) != wantDigest {
		return errors.New("copied recovery file failed integrity verification")
	}
	if err := destination.Sync(); err != nil {
		return err
	}
	if err := destination.Close(); err != nil {
		return err
	}
	completed = true
	return nil
}

func validateMaterializedRecovery(databasePath, attachmentsDir string, manifest recoveryManifest) error {
	if err := validateBackupDatabase(databasePath); err != nil {
		return err
	}
	expected, err := recoveryAttachmentsFromDatabase(databasePath)
	if err != nil {
		return err
	}
	if len(expected) != len(manifest.Attachments) {
		return errors.New("materialized attachment set does not match recovery database")
	}
	for i := range expected {
		want := expected[i]
		got := manifest.Attachments[i]
		if got.ID != want.ID || got.StorageName != want.StorageName || got.ByteSize != want.ByteSize || !validSHA256Digest(got.SHA256) {
			return fmt.Errorf("materialized attachment identity mismatch for %s", want.ID)
		}
		hash, size, err := hashFile(filepath.Join(attachmentsDir, got.StorageName))
		if err != nil {
			return fmt.Errorf("read materialized attachment %s: %w", got.ID, err)
		}
		if size != got.ByteSize || hash != got.SHA256 {
			return fmt.Errorf("materialized attachment verification failed for %s", got.ID)
		}
	}
	return nil
}
