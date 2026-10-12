package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"jpano.dev/portfolio/internal/config"
	"jpano.dev/portfolio/internal/database"
	mediastore "jpano.dev/portfolio/internal/storage"
)

func main() {
	log.SetFlags(0)
	settings, err := config.Load()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}
	if settings.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is empty in the root .env.")
	}

	db, err := database.Open(settings.DatabaseURL)
	if err != nil {
		log.Fatal("Unable to connect to PostgreSQL/Supabase. Verify DATABASE_URL, password, and network access.")
	}
	defer db.Close()

	initialized, err := database.Ensure(db, settings.Root, true)
	if err != nil {
		log.Fatalf("Database setup check failed: %v", err)
	}
	if initialized {
		fmt.Println("Initialized the missing portfolio schema/data.")
	}
	if err := database.Align(db, settings.Root); err != nil {
		log.Fatalf("Database alignment failed: %v", err)
	}

	store, err := mediastore.FromEnvironment(settings.DatabaseURL)
	if err != nil {
		log.Fatalf("Storage configuration error: %v", err)
	}
	storageAuto := strings.EqualFold(os.Getenv("STORAGE_AUTO_MIGRATE"), "true")
	storageRequired := strings.EqualFold(os.Getenv("STORAGE_REQUIRED"), "true")
	if store == nil && storageRequired {
		log.Fatal("Supabase Storage is required, but SUPABASE_SECRET_KEY is not configured.")
	}
	if store != nil && storageAuto {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		certs, media, migrateErr := mediastore.MigrateLegacy(ctx, db, store)
		cancel()
		if migrateErr != nil {
			log.Fatalf("Supabase Storage migration failed: %v", migrateErr)
		}
		if certs > 0 || media > 0 {
			fmt.Printf("Migrated legacy media to Supabase Storage: %d certificate(s), %d project/profile image(s).\n", certs, media)
		}
	} else if store == nil {
		fmt.Println("Supabase Storage migration skipped: SUPABASE_SECRET_KEY is not configured.")
	} else {
		fmt.Println("Supabase Storage migration skipped: STORAGE_AUTO_MIGRATE is not true.")
	}

	legacyCerts, legacyMedia, err := mediastore.LegacyCounts(context.Background(), db)
	if err != nil {
		log.Fatalf("Unable to inspect legacy image storage: %v", err)
	}

	counts := []struct {
		label string
		table string
	}{
		{"Information JSON rows", "personal_information"},
		{"Projects", "projects"},
		{"Certificates", "certificates"},
		{"Career documents", "career_profiles"},
		{"Chat threads", "chat_threads"},
		{"Chat messages", "chat_messages"},
		{"Feedback", "feedback"},
		{"Page visits", "page_visits"},
	}

	fmt.Println("Database clean/alignment complete.")
	fmt.Println("Schema: portfolio")
	fmt.Printf("Schema version: %d\n", database.SchemaVersion)
	for _, item := range counts {
		var n int64
		if err := db.QueryRow("SELECT COUNT(*) FROM " + item.table).Scan(&n); err != nil {
			log.Fatalf("Unable to count %s: %v", item.table, err)
		}
		fmt.Printf("%-23s %d\n", item.label+":", n)
	}
	fmt.Printf("Legacy certificate BLOBs: %d\n", legacyCerts)
	fmt.Printf("Legacy project BLOBs:     %d\n", legacyMedia)
	if legacyCerts == 0 && legacyMedia == 0 {
		fmt.Println("Media storage: Supabase Storage URLs/paths (no legacy image BLOBs remain).")
	} else {
		fmt.Println("Media storage: legacy BLOB fallback remains until SUPABASE_SECRET_KEY is configured and cleandb.bat succeeds.")
	}
	fmt.Println("Expired access/auth sessions were cleaned. Portfolio content was not reset or deleted.")
	_ = os.Stdout.Sync()
}
