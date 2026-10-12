package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCrossOriginPolicy(t *testing.T) {
	a := &app{origins: map[string]bool{"https://jpano.dev": true}}
	h := a.crossOrigin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	cases := []struct {
		method, origin, marker string
		want                   int
	}{
		{"GET", "https://jpano.dev", "", 204}, {"GET", "https://evil.example", "", 403},
		{"POST", "https://jpano.dev", "1", 204}, {"POST", "https://jpano.dev", "", 403},
		{"POST", "", "1", 403}, {"OPTIONS", "https://jpano.dev", "", 204}, {"OPTIONS", "", "", 403},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, "/api/public/contact", nil)
		r.Header.Set("Origin", c.origin)
		r.Header.Set("X-Portfolio-Request", c.marker)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s %q marker %q: status %d want %d", c.method, c.origin, c.marker, w.Code, c.want)
		}
		if c.origin == "https://jpano.dev" && w.Header().Get("Access-Control-Allow-Origin") != c.origin {
			t.Error("allowed origin not returned")
		}
	}
}
func TestHealthWithoutDatabase(t *testing.T) {
	w := httptest.NewRecorder()
	(&app{}).health(w, httptest.NewRequest("GET", "/api/health", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"online":true`) || !strings.Contains(w.Body.String(), `"ready":false`) {
		t.Fatalf("unexpected response %d %s", w.Code, w.Body.String())
	}
}
func TestUnavailableDatabaseGuard(t *testing.T) {
	called := false
	h := (&app{}).databaseReady(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/admin/information", nil))
	if called || w.Code != 503 {
		t.Fatal("uninitialized DB reached application handler")
	}
}
func TestProjectPagination(t *testing.T) {
	projects := make([]managedProject, 20)
	for _, c := range []struct {
		page              string
		wantPage, wantLen int
	}{{"1", 1, 9}, {"2", 2, 9}, {"3", 3, 2}, {"999", 3, 2}, {"-1", 1, 9}} {
		w := httptest.NewRecorder()
		projectPage(w, httptest.NewRequest("GET", "/api/public/projects?page="+c.page, nil), projects, 9)
		var response struct {
			Items          []managedProject `json:"items"`
			Page, PageSize int
			TotalPages     int `json:"total_pages"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Page != c.wantPage || len(response.Items) != c.wantLen || response.TotalPages != 3 {
			t.Fatalf("bad page %s: %s", c.page, w.Body.String())
		}
	}
}
func TestProjectValidation(t *testing.T) {
	good := managedProject{Name: "A real project", URL: "https://example.com", Images: []string{"/assets/projects/project-placeholder.svg"}}
	if err := validateProject(good); err != nil {
		t.Fatal(err)
	}
	for _, link := range []string{"javascript:alert(1)", "http://127.0.0.1", "https://user:password@example.com", "http://169.254.169.254"} {
		bad := good
		bad.URL = link
		if validateProject(bad) == nil {
			t.Errorf("accepted %s", link)
		}
	}
	bad := good
	bad.Images = make([]string, 13)
	if validateProject(bad) == nil {
		t.Error("accepted 13 images")
	}
	for _, image := range []string{"/assets/../private", "/assets/%2e%2e/private", "//evil.example/x.png", "data:image/svg+xml,test"} {
		if validMediaURL(image) {
			t.Errorf("accepted %q", image)
		}
	}
}
func TestInformationSeedAndInvalidEdits(t *testing.T) {
	data, err := os.ReadFile("../client/assets/data/public-snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	var snapshot struct {
		Information json.RawMessage `json:"information"`
	}
	if err = json.Unmarshal(data, &snapshot); err != nil {
		t.Fatal(err)
	}
	if err = validateInformation(snapshot.Information); err != nil {
		t.Fatalf("seed information rejected: %v", err)
	}
	for _, s := range []string{`null`, `[]`, `{"name":{"full":""}}`, `{"name":{"full":"Test"},"skills":{"it":[]}}`, `{"name":{"full":"Test"},"contact":{"links":{"github":"javascript:alert(1)"}}}`} {
		if validateInformation([]byte(s)) == nil {
			t.Errorf("accepted invalid information %s", s)
		}
	}
}
func TestPrivateDestinationsRejected(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1", "64:ff9b::7f00:1"} {
		if allowedIP(netip.MustParseAddr(s)) {
			t.Errorf("private IP %s allowed", s)
		}
	}
	for _, s := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		if !allowedIP(netip.MustParseAddr(s)) {
			t.Errorf("public IP %s rejected", s)
		}
	}
}
func TestUnicodeSafeTruncation(t *testing.T) {
	got := clean("   Portfolio \u00f1\U0001f680\U0001f680   ", 12)
	if !utf8.ValidString(got) || utf8.RuneCountInString(got) > 12 {
		t.Errorf("invalid truncation %q", got)
	}
}

func TestChatVisitorMetadataHelpers(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/public/chat/status", nil)
	request.RemoteAddr = "127.0.0.1:5050"
	request.Header.Set("CF-Connecting-IP", "203.0.113.45")
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36")
	if got := requestClientIP(request); got != "203.0.113.45" {
		t.Fatalf("requestClientIP=%q", got)
	}
	agent, platform := summarizeUserAgent(request.UserAgent())
	if agent != "Chrome 154" || platform != "Windows" {
		t.Fatalf("unexpected agent/platform %q %q", agent, platform)
	}
}
