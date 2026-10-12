package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestBearerCompletion(t *testing.T) {
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/chat/completions" || r.Method != "POST" {
			t.Error("bad request path/method")
		}
		got = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello, visitor!"}}]}`))
	}))
	defer server.Close()
	c, err := New(server.URL, "testing-key", "")
	if err != nil {
		t.Fatal(err)
	}
	answer, err := c.Chat(context.Background(), []Message{{Role: "system", Content: "Follow rules"}, {Role: "user", Content: "Hi"}})
	if err != nil || answer != "Hello, visitor!" || got != "Bearer testing-key" {
		t.Fatalf("bad result: %q %v", answer, err)
	}
}
func TestRejectBadEndpoint(t *testing.T) {
	for _, u := range []string{"http://example.com", "file:///tmp/test", "https://test.invalid/arbitrary", "https://user:password@example.com"} {
		if _, err := New(u, "x", ""); err == nil {
			t.Errorf("accepted: %s", u)
		}
	}
}
