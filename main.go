package main

import (
	"context"
	"embed"
	"log"

	"github.com/savior714/flashnote/internal/appdata"
	"github.com/savior714/flashnote/internal/persistence"
	"github.com/wailsapp/wails/v3/pkg/application"
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

	app := application.New(application.Options{
		Name:        "Flashnote",
		Description: "A lightweight local-first document note app",
		Services: []application.Service{
			application.NewService(NewAppService(store)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
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

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
