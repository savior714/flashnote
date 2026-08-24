package appdata

import (
	"fmt"
	"os"
	"path/filepath"
)

const appDirectoryName = "Flashnote"

func RootDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}

	root := filepath.Join(base, appDirectoryName)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create application data directory: %w", err)
	}
	return root, nil
}

func DatabasePath() (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "flashnote.db"), nil
}
