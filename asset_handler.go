package main

import (
	"errors"
	"net/http"
	"strings"

	"github.com/savior714/flashnote/internal/persistence"
)

const attachmentURLPrefix = "/attachments/"

func attachmentMiddleware(store *persistence.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, attachmentURLPrefix) {
				next.ServeHTTP(w, r)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}

			attachmentID := strings.TrimPrefix(r.URL.Path, attachmentURLPrefix)
			if attachmentID == "" || strings.Contains(attachmentID, "/") {
				http.NotFound(w, r)
				return
			}
			opened, err := store.OpenAttachment(r.Context(), attachmentID)
			if errors.Is(err, persistence.ErrAttachmentNotFound) {
				http.NotFound(w, r)
				return
			}
			if err != nil {
				http.Error(w, "attachment unavailable", http.StatusInternalServerError)
				return
			}
			defer opened.File.Close()

			info, err := opened.File.Stat()
			if err != nil {
				http.Error(w, "attachment unavailable", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", opened.MediaType)
			w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
			http.ServeContent(w, r, attachmentID, info.ModTime(), opened.File)
		})
	}
}
