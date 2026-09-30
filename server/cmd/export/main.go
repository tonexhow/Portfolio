// Export the publishable DB state and media into a Vercel-independent fallback.
// No access sessions, unpublished records, contact messages or visits are exported.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"jpano.dev/portfolio/internal/config"
	"jpano.dev/portfolio/internal/content"
	"jpano.dev/portfolio/internal/database"
)

var certPath = regexp.MustCompile(`^/api/public/certificates/([0-9]+)/(image|download)$`)
var mediaPath = regexp.MustCompile(`^/api/public/project-media/([A-Za-z0-9_-]+)$`)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	if c.DatabaseURL == "" {
		return errors.New("set DATABASE_URL in the project-root .env after creating the Supabase database")
	}
	db, err := database.Open(c.DatabaseURL)
	if err != nil {
		return errors.New("database connection failed; verify DATABASE_URL and connectivity (credentials are not logged)")
	}
	defer db.Close()
	if err = database.Init(db); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	snapshot, err := content.Load(ctx, db)
	if err != nil {
		return errors.New("unable to read the public portfolio snapshot")
	}
	dest := filepath.Join(c.ClientDir, "assets", "published")
	if err = os.MkdirAll(dest, 0755); err != nil {
		return err
	}
	cache := map[string]string{}
	materialize := func(value string) (string, error) {
		if !strings.HasPrefix(value, "/api/public/") {
			return value, nil
		}
		if path, ok := cache[value]; ok {
			return path, nil
		}
		u, e := url.Parse(value)
		if e != nil {
			return "", e
		}
		var bytes []byte
		var mime string
		if matches := certPath.FindStringSubmatch(u.Path); matches != nil {
			e = db.QueryRowContext(ctx, `SELECT image_blob,image_mime FROM certificates WHERE id=$1 AND visible=1`, matches[1]).Scan(&bytes, &mime)
		} else if matches := mediaPath.FindStringSubmatch(u.Path); matches != nil {
			// Only URLs present in the public snapshot reach this exporter.
			e = db.QueryRowContext(ctx, `SELECT image_blob,image_mime FROM project_media WHERE id=$1`, matches[1]).Scan(&bytes, &mime)
		} else {
			return "", fmt.Errorf("unsupported published media path: %s", u.Path)
		}
		if e != nil {
			return "", fmt.Errorf("a published image is unavailable: %s", u.Path)
		}
		extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}[mime]
		if extension == "" || len(bytes) > 8*1024*1024 {
			return "", errors.New("a published image has an unsupported format or size")
		}
		hash := sha256.Sum256(bytes)
		name := "published-" + hex.EncodeToString(hash[:12]) + "." + extension
		if e = os.WriteFile(filepath.Join(dest, name), bytes, 0644); e != nil {
			return "", e
		}
		path := "/assets/published/" + name
		cache[value] = path
		return path, nil
	}
	for i := range snapshot.Certificates {
		path, e := materialize(snapshot.Certificates[i].ImageURL)
		if e != nil {
			return e
		}
		snapshot.Certificates[i].ImageURL = path
		snapshot.Certificates[i].DownloadURL = path
	}
	for i := range snapshot.Projects {
		p := &snapshot.Projects[i]
		p.Icon, err = materialize(p.Icon)
		if err != nil {
			return err
		}
		for j := range p.Images {
			p.Images[j], err = materialize(p.Images[j])
			if err != nil {
				return err
			}
		}
		p.Status = "unknown"
		p.CheckedAt = nil
	}
	for i := range snapshot.Feedback {
		snapshot.Feedback[i].AvatarURL = ""
	}
	for i := range snapshot.Profiles.Items {
		snapshot.Profiles.Items[i], err = materialize(snapshot.Profiles.Items[i])
		if err != nil {
			return err
		}
	}
	var info map[string]json.RawMessage
	if err = json.Unmarshal(snapshot.Information, &info); err != nil {
		return err
	}
	info["profile_images"], err = json.Marshal(snapshot.Profiles.Items)
	if err != nil {
		return err
	}
	snapshot.Information, err = json.Marshal(info)
	if err != nil {
		return err
	}
	// Keep the DB timestamp: export time must not outrank a newer browser-cached edit.
	bytes, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(c.ClientDir, "assets", "data", "public-snapshot.json")
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".snapshot-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(append(bytes, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	log.Printf("Exported %d projects, %d certificates and %d approved feedback records. Rebuild/redeploy client/ to publish the offline fallback.", len(snapshot.Projects), len(snapshot.Certificates), len(snapshot.Feedback))
	return nil
}
