package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func sessionSameSite() http.SameSite {
	if strings.EqualFold(env("COOKIE_SAME_SITE", "lax"), "none") {
		return http.SameSiteNoneMode
	}
	return http.SameSiteLaxMode
}
func (a *app) crossOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !a.origins[origin] {
				writeError(w, http.StatusForbidden, "This website is not allowed to use the API.")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin == "" {
				writeError(w, http.StatusForbidden, "An allowed origin is required.")
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Portfolio-Request")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// CSRF protection for cookie-authenticated writes. Browser JS supplies Origin
		// and a non-simple header; no wildcard origins or credentials in the frontend.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin == "" || !a.origins[origin] || r.Header.Get("X-Portfolio-Request") != "1" {
				writeError(w, http.StatusForbidden, "The request could not be verified. Refresh the page and try again.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *app) databaseReady(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" && r.URL.Path != "/" && a.db == nil {
			writeError(w, http.StatusServiceUnavailable, "The server is temporarily unavailable. Please try again later.")
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (a *app) health(w http.ResponseWriter, r *http.Request) {
	// HTTP 200 means the Go API process itself is reachable. Database readiness is
	// reported separately so the header does not call a running backend "offline".
	result := map[string]any{"online": true, "ready": false, "database": false, "storage": a.mediaStore != nil, "service": "jpano-portfolio-api"}
	if a.db == nil {
		writeJSON(w, http.StatusOK, result)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	var revision int64
	if err := a.db.QueryRowContext(ctx, "SELECT revision FROM portfolio.sync_state WHERE id=1").Scan(&revision); err != nil {
		writeJSON(w, http.StatusOK, result)
		return
	}
	result["ready"] = true
	result["database"] = true
	result["revision"] = revision
	writeJSON(w, http.StatusOK, result)
}
func writeRawJSON(w http.ResponseWriter, status int, v json.RawMessage) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(v)
}
