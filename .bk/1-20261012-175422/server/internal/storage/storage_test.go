package storage

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestDeriveProjectURL(t *testing.T) {
	got, err := deriveProjectURL("postgresql://postgres.abc123:secret@aws-0-region.pooler.supabase.com:5432/postgres")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://abc123.supabase.co" {
		t.Fatalf("got %q", got)
	}
}

func TestStorageLifecycleRequests(t *testing.T) {
	var mu sync.Mutex
	bucketExists := false
	objects := map[string]string{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "sb_secret_test" {
			http.Error(w, "missing key", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/storage/v1/bucket/portfolio-media":
			mu.Lock()
			exists := bucketExists
			mu.Unlock()
			if !exists {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"id":"portfolio-media","public":true}`)
		case r.Method == http.MethodPost && r.URL.Path == "/storage/v1/bucket":
			mu.Lock()
			bucketExists = true
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPut && r.URL.Path == "/storage/v1/bucket/portfolio-media":
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/storage/v1/object/portfolio-media/"):
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			objects[strings.TrimPrefix(r.URL.Path, "/storage/v1/object/portfolio-media/")] = string(body)
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/storage/v1/object/portfolio-media/"):
			mu.Lock()
			delete(objects, strings.TrimPrefix(r.URL.Path, "/storage/v1/object/portfolio-media/"))
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		default:
			http.Error(w, "unexpected request", http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client := &Client{BaseURL: srv.URL, Key: "sb_secret_test", Bucket: "portfolio-media", HTTP: srv.Client()}
	if err := client.EnsureBucket(context.Background()); err != nil {
		t.Fatalf("ensure bucket: %v", err)
	}
	url, err := client.Upload(context.Background(), "certificates/1.png", "image/png", []byte("png"))
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if !strings.HasSuffix(url, "/storage/v1/object/public/portfolio-media/certificates/1.png") {
		t.Fatalf("unexpected public URL: %s", url)
	}
	if err := client.Delete(context.Background(), "certificates/1.png"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(objects) != 0 {
		t.Fatalf("expected uploaded object to be removed, got %#v", objects)
	}
}

func TestObjectPathStableAndTyped(t *testing.T) {
	one, err := ObjectPath("certificates", "12", "image/png", []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	two, err := ObjectPath("certificates", "12", "image/png", []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	if one != two || !strings.HasPrefix(one, "certificates/12-") || !strings.HasSuffix(one, ".png") {
		t.Fatalf("unexpected object path: %q / %q", one, two)
	}
	if _, err := ObjectPath("certificates", "12", "text/plain", []byte("x")); err == nil {
		t.Fatal("expected unsupported MIME type to fail")
	}
}
