package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"jpano.dev/portfolio/internal/database"
)

type Client struct {
	BaseURL string
	Key     string
	Bucket  string
	HTTP    *http.Client
}

func FromEnvironment(databaseURL string) (*Client, error) {
	key := strings.TrimSpace(os.Getenv("SUPABASE_SECRET_KEY"))
	if key == "" {
		return nil, nil
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	if base == "" {
		var err error
		base, err = deriveProjectURL(databaseURL)
		if err != nil {
			return nil, err
		}
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("SUPABASE_URL must be an HTTPS origin such as https://PROJECT_REF.supabase.co")
	}
	bucket := strings.TrimSpace(os.Getenv("SUPABASE_STORAGE_BUCKET"))
	if bucket == "" {
		bucket = "portfolio-media"
	}
	if !validBucket(bucket) {
		return nil, errors.New("SUPABASE_STORAGE_BUCKET contains invalid characters")
	}
	return &Client{
		BaseURL: parsed.Scheme + "://" + parsed.Host,
		Key:     key,
		Bucket:  bucket,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func deriveProjectURL(databaseURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(databaseURL))
	if err != nil || u.User == nil {
		return "", errors.New("set SUPABASE_URL because it could not be derived from DATABASE_URL")
	}
	username := u.User.Username()
	const prefix = "postgres."
	if !strings.HasPrefix(username, prefix) || len(username) <= len(prefix) {
		return "", errors.New("set SUPABASE_URL because it could not be derived from DATABASE_URL")
	}
	ref := strings.TrimPrefix(username, prefix)
	for _, r := range ref {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return "", errors.New("set SUPABASE_URL because the project reference could not be derived safely")
		}
	}
	return "https://" + ref + ".supabase.co", nil
}

func validBucket(value string) bool {
	if value == "" || len(value) > 63 {
		return false
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func (c *Client) addAuth(req *http.Request) {
	req.Header.Set("apikey", c.Key)
	req.Header.Set("User-Agent", "JPano-Portfolio-Server/1.0")
}

func (c *Client) do(req *http.Request) (*http.Response, []byte, error) {
	c.addAuth(req)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if readErr != nil {
		return res, nil, readErr
	}
	return res, body, nil
}

func (c *Client) EnsureBucket(ctx context.Context) error {
	endpoint := c.BaseURL + "/storage/v1/bucket/" + url.PathEscape(c.Bucket)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	res, body, err := c.do(req)
	if err == nil && res.StatusCode >= 200 && res.StatusCode < 300 {
		return c.makeBucketPublic(ctx)
	}
	if err != nil {
		return fmt.Errorf("check Supabase Storage bucket: %w", err)
	}
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusBadRequest {
		return fmt.Errorf("check Supabase Storage bucket: HTTP %d: %s", res.StatusCode, compact(body))
	}

	payload, _ := json.Marshal(map[string]any{
		"id":                 c.Bucket,
		"name":               c.Bucket,
		"public":             true,
		"file_size_limit":    12 * 1024 * 1024,
		"allowed_mime_types": []string{"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"},
	})
	req, _ = http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/storage/v1/bucket", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	res, body, err = c.do(req)
	if err != nil {
		return fmt.Errorf("create Supabase Storage bucket: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// A bucket may have been created between the HEAD and POST. Try to update it
		// before treating the create response as fatal.
		if updateErr := c.makeBucketPublic(ctx); updateErr == nil {
			return nil
		}
		return fmt.Errorf("create Supabase Storage bucket: HTTP %d: %s", res.StatusCode, compact(body))
	}
	return c.makeBucketPublic(ctx)
}

func (c *Client) makeBucketPublic(ctx context.Context) error {
	payload, _ := json.Marshal(map[string]any{
		"public":             true,
		"file_size_limit":    12 * 1024 * 1024,
		"allowed_mime_types": []string{"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"},
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPut, c.BaseURL+"/storage/v1/bucket/"+url.PathEscape(c.Bucket), bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	res, body, err := c.do(req)
	if err != nil {
		return fmt.Errorf("configure Supabase Storage bucket: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("configure Supabase Storage bucket: HTTP %d: %s", res.StatusCode, compact(body))
	}
	return nil
}

func (c *Client) Upload(ctx context.Context, objectPath, mime string, data []byte) (string, error) {
	return c.upload(ctx, objectPath, mime, data, false)
}

func (c *Client) UploadUpsert(ctx context.Context, objectPath, mime string, data []byte) (string, error) {
	return c.upload(ctx, objectPath, mime, data, true)
}

func (c *Client) upload(ctx context.Context, objectPath, mime string, data []byte, upsert bool) (string, error) {
	objectPath = cleanObjectPath(objectPath)
	if objectPath == "" {
		return "", errors.New("invalid storage object path")
	}
	endpoint := c.BaseURL + "/storage/v1/object/" + url.PathEscape(c.Bucket) + "/" + escapeObjectPath(objectPath)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	req.Header.Set("Content-Type", mime)
	req.Header.Set("Cache-Control", "public, max-age=31536000, immutable")
	if upsert {
		req.Header.Set("x-upsert", "true")
	} else {
		req.Header.Set("x-upsert", "false")
	}
	res, body, err := c.do(req)
	if err != nil {
		return "", fmt.Errorf("upload Supabase Storage object: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("upload Supabase Storage object: HTTP %d: %s", res.StatusCode, compact(body))
	}
	return c.PublicURL(objectPath), nil
}

func (c *Client) Delete(ctx context.Context, objectPath string) error {
	objectPath = cleanObjectPath(objectPath)
	if objectPath == "" {
		return nil
	}
	endpoint := c.BaseURL + "/storage/v1/object/" + url.PathEscape(c.Bucket) + "/" + escapeObjectPath(objectPath)
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	res, body, err := c.do(req)
	if err != nil {
		return err
	}
	if res.StatusCode == http.StatusNotFound || (res.StatusCode >= 200 && res.StatusCode < 300) {
		return nil
	}
	return fmt.Errorf("delete Supabase Storage object: HTTP %d: %s", res.StatusCode, compact(body))
}

func (c *Client) PublicURL(objectPath string) string {
	objectPath = cleanObjectPath(objectPath)
	if objectPath == "" {
		return ""
	}
	return c.BaseURL + "/storage/v1/object/public/" + url.PathEscape(c.Bucket) + "/" + escapeObjectPath(objectPath)
}

func ObjectPath(kind, id, mime string, data []byte) (string, error) {
	ext := map[string]string{
		"image/png":       ".png",
		"image/jpeg":      ".jpg",
		"image/webp":      ".webp",
		"image/gif":       ".gif",
		"application/pdf": ".pdf",
	}[mime]
	if ext == "" {
		return "", errors.New("unsupported image MIME type")
	}
	hash := sha256.Sum256(data)
	slug := strings.Trim(strings.ToLower(kind), "/")
	if slug == "" {
		slug = "media"
	}
	id = strings.TrimSpace(id)
	if id == "" {
		id = "item"
	}
	id = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, id)
	return path.Join(slug, id+"-"+hex.EncodeToString(hash[:8])+ext), nil
}

func MigrateLegacy(ctx context.Context, db *database.DB, c *Client) (int, int, error) {
	if c == nil {
		return 0, 0, nil
	}
	if err := c.EnsureBucket(ctx); err != nil {
		return 0, 0, err
	}

	certCount := 0
	rows, err := db.QueryContext(ctx, `SELECT id,image_blob,image_mime FROM certificates WHERE COALESCE(storage_url,'')='' AND image_blob IS NOT NULL ORDER BY id`)
	if err != nil {
		return 0, 0, err
	}
	type cert struct {
		id   int64
		data []byte
		mime string
	}
	certs := []cert{}
	for rows.Next() {
		var item cert
		if err = rows.Scan(&item.id, &item.data, &item.mime); err != nil {
			rows.Close()
			return 0, 0, err
		}
		certs = append(certs, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, 0, err
	}
	for _, item := range certs {
		objectPath, e := ObjectPath("certificates", fmt.Sprint(item.id), item.mime, item.data)
		if e != nil {
			return certCount, 0, e
		}
		publicURL, e := c.UploadUpsert(ctx, objectPath, item.mime, item.data)
		if e != nil {
			return certCount, 0, fmt.Errorf("certificate %d: %w", item.id, e)
		}
		if _, e = db.ExecContext(ctx, `UPDATE certificates SET storage_path=$1,storage_url=$2,image_blob=NULL,updated_at=clock_timestamp() WHERE id=$3`, objectPath, publicURL, item.id); e != nil {
			_ = c.Delete(context.Background(), objectPath)
			return certCount, 0, e
		}
		certCount++
	}

	mediaCount := 0
	rows, err = db.QueryContext(ctx, `SELECT id,image_blob,image_mime FROM project_media WHERE COALESCE(storage_url,'')='' AND image_blob IS NOT NULL ORDER BY created_at,id`)
	if err != nil {
		return certCount, 0, err
	}
	type media struct {
		id   string
		data []byte
		mime string
	}
	mediaItems := []media{}
	for rows.Next() {
		var item media
		if err = rows.Scan(&item.id, &item.data, &item.mime); err != nil {
			rows.Close()
			return certCount, mediaCount, err
		}
		mediaItems = append(mediaItems, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return certCount, mediaCount, err
	}
	for _, item := range mediaItems {
		objectPath, e := ObjectPath("projects", item.id, item.mime, item.data)
		if e != nil {
			return certCount, mediaCount, e
		}
		publicURL, e := c.UploadUpsert(ctx, objectPath, item.mime, item.data)
		if e != nil {
			return certCount, mediaCount, fmt.Errorf("project media %s: %w", item.id, e)
		}
		oldURL := "/api/public/project-media/" + item.id
		tx, e := db.BeginTx(ctx, nil)
		if e != nil {
			_ = c.Delete(context.Background(), objectPath)
			return certCount, mediaCount, e
		}
		failed := false
		statements := []struct {
			q    string
			args []any
		}{
			{`UPDATE project_media SET storage_path=$1,storage_url=$2,image_blob=NULL WHERE id=$3`, []any{objectPath, publicURL, item.id}},
			{`UPDATE projects SET icon=$2,updated_at=clock_timestamp() WHERE icon=$1`, []any{oldURL, publicURL}},
			{`UPDATE projects SET images_json=replace(images_json::text,$1,$2)::jsonb,updated_at=clock_timestamp() WHERE images_json::text LIKE '%'||$1||'%'`, []any{oldURL, publicURL}},
			{`UPDATE personal_information SET content=replace(content::text,$1,$2)::jsonb,version=version+1,updated_at=clock_timestamp() WHERE content::text LIKE '%'||$1||'%'`, []any{oldURL, publicURL}},
		}
		for _, statement := range statements {
			if _, e = tx.Exec(statement.q, statement.args...); e != nil {
				failed = true
				break
			}
		}
		if failed {
			tx.Rollback()
			_ = c.Delete(context.Background(), objectPath)
			return certCount, mediaCount, e
		}
		if e = tx.Commit(); e != nil {
			_ = c.Delete(context.Background(), objectPath)
			return certCount, mediaCount, e
		}
		mediaCount++
	}
	return certCount, mediaCount, nil
}

func LegacyCounts(ctx context.Context, db *database.DB) (int, int, error) {
	var certificates, media int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM certificates WHERE image_blob IS NOT NULL`).Scan(&certificates); err != nil {
		return 0, 0, err
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM project_media WHERE image_blob IS NOT NULL`).Scan(&media); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, 0, err
	}
	return certificates, media, nil
}

func cleanObjectPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	value = strings.TrimPrefix(path.Clean("/"+value), "/")
	if value == "." || value == "" || strings.Contains(value, "..") {
		return ""
	}
	return value
}

func escapeObjectPath(value string) string {
	parts := strings.Split(value, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}

func compact(body []byte) string {
	text := strings.Join(strings.Fields(string(body)), " ")
	if len(text) > 220 {
		text = text[:220] + "..."
	}
	if text == "" {
		return "no response body"
	}
	return text
}
