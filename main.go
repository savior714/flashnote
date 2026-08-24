package main

import (
	"context"
	"embed"
	"log"
	"sync/atomic"

	"github.com/savior714/flashnote/internal/appdata"
	"github.com/savior714/flashnote/internal/persistence"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	closeRequestedEvent = "flashnote:close-requested"
	closeApprovedEvent  = "flashnote:close-approved"
	closeDiscardEvent   = "flashnote:close-discard"
	frontendReadyEvent  = "flashnote:frontend-ready"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	ctx := context.Background()
	databasePath, err := appdata.DatabasePath()
	if err != nil {
		log.Fatal(err)
	}

	store, err := persistence.Open(ctx, databasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Printf("close database: %v", err)
		}
	}()
	if err := store.ReconcileStoredAttachments(ctx, true); err != nil {
		log.Printf("FLASHNOTE_ATTACHMENT_RECONCILE_FAILED reason=startup error=%v", err)
	}

	app := application.New(application.Options{
		Name:        "Flashnote",
		Description: "A lightweight local-first document note app",
		Services: []application.Service{
			application.NewService(NewAppService(store)),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: attachmentMiddleware(store),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Flashnote",
		Width:     1100,
		Height:    720,
		MinWidth:  760,
		MinHeight: 520,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 48,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(247, 246, 242),
		URL:              "/",
	})

	var frontendReady atomic.Bool
	var allowClose atomic.Bool

	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !frontendReady.Load() || allowClose.Swap(false) {
			return
		}
		log.Print("FLASHNOTE_CLOSE_FLUSH_REQUESTED")
		event.Cancel()
		window.EmitEvent(closeRequestedEvent)
	})

	app.Event.On(frontendReadyEvent, func(_ *application.CustomEvent) {
		frontendReady.Store(true)
	})
	app.Event.On(closeApprovedEvent, func(_ *application.CustomEvent) {
		log.Print("FLASHNOTE_CLOSE_APPROVED")
		allowClose.Store(true)
		window.Close()
	})
	app.Event.On(closeDiscardEvent, func(_ *application.CustomEvent) {
		log.Print("FLASHNOTE_CLOSE_DISCARDED")
		allowClose.Store(true)
		window.Close()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
