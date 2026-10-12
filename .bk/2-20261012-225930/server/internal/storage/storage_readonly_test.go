package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckBucketNeverWrites(t *testing.T) {
	writes := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writes++
			w.WriteHeader(405)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"portfolio-media","public":true}`))
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, Bucket: "portfolio-media", Key: "fake", HTTP: srv.Client()}
	if err := c.CheckBucket(context.Background()); err != nil {
		t.Fatal(err)
	}
	if writes != 0 {
		t.Fatalf("unexpected storage mutation: %d", writes)
	}
}
