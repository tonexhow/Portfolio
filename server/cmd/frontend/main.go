// Frontend-only development server. It needs neither PostgreSQL nor third-party Go packages.
package main

import (
	"encoding/json"
	"jpano.dev/portfolio/internal/config"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	c, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	routes := map[string]string{"/": "index.html", "/index": "index.html", "/admin": "admin.html", "/access": "access.html", "/access/verify": "access-verify.html", "/access/grant": "access-grant.html", "/privacy": "privacy.html", "/terms": "terms.html", "/data-deletion": "data-deletion.html"}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Keep one loopback hostname in local development. Mixing localhost and
		// 127.0.0.1 makes browser cookies cross-site and can also make localhost
		// resolve to IPv6 while the Go API is intentionally bound to IPv4.
		host := strings.ToLower(r.Host)
		if strings.HasPrefix(host, "localhost:") || host == "localhost" || strings.HasPrefix(host, "[::1]:") || host == "[::1]" {
			target := "http://127.0.0.1:" + c.FrontendPort + r.URL.RequestURI()
			http.Redirect(w, r, target, http.StatusTemporaryRedirect)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/config.js" {
			public := map[string]any{"apiBaseURL": c.APIOrigin, "statusIntervalMs": 30000, "requestTimeoutMs": 7000}
			data, _ := json.Marshal(public)
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			_, _ = w.Write(append(append([]byte("window.APP_CONFIG = Object.freeze("), data...), []byte(");\n")...))
			return
		}
		clean := path.Clean(r.URL.Path)
		for _, part := range strings.Split(clean, "/") {
			if strings.HasPrefix(part, ".") || strings.Contains(part, "\\") {
				http.NotFound(w, r)
				return
			}
		}
		name, ok := routes[strings.TrimSuffix(clean, "/")]
		if clean == "/" {
			name = "index.html"
			ok = true
		}
		if !ok {
			name = strings.TrimPrefix(clean, "/")
		}
		// Never serve source tooling, dependency metadata, or arbitrary files.
		ext := strings.ToLower(filepath.Ext(name))
		allowed := map[string]bool{".html": true, ".css": true, ".js": true, ".json": true, ".svg": true, ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true, ".ico": true, ".woff": true, ".woff2": true, ".txt": true, ".xml": true}
		if !allowed[ext] || name == "package.json" || name == "vercel.json" || strings.HasPrefix(name, "dist/") {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(c.ClientDir, filepath.FromSlash(name))
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, full)
	})
	server := &http.Server{Addr: net.JoinHostPort("127.0.0.1", c.FrontendPort), Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Frontend: http://127.0.0.1:%s | API: %s", c.FrontendPort, c.APIOrigin)
	log.Fatal(server.ListenAndServe())
}
