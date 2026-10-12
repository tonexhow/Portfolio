package main

// Explicit, Admin-only external network diagnostics. Never use arbitrary URLs,
// render provider API data publicly, or run unbounded speed tests.
import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

func (a *app) adminNetworkCheck(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "network-check", 4, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "Please wait before running another network test.")
		return
	}
	result := map[string]any{
		"source":        "Optional external network lookup; a short Cloudflare download sample",
		"provider":      "Unavailable",
		"public_ip":     "Unavailable",
		"download_mbps": nil,
		"accuracy":      "Provider is inferred from the public IP operator; measured download rate is one small sample, not a guaranteed connection speed.",
	}
	context, cancel := context.WithTimeout(r.Context(), 18*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(context, http.MethodGet, "https://ipinfo.io/json", nil)
	if err == nil {
		request.Header.Set("Accept", "application/json")
		response, reqErr := client.Do(request)
		if reqErr == nil {
			if response.StatusCode == http.StatusOK {
				var report struct {
					IP  string `json:"ip"`
					Org string `json:"org"`
				}
				if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&report) == nil {
					if net.ParseIP(report.IP) != nil {
						result["public_ip"] = report.IP
					}
					// Do not accept oversized or unsafe HTML/URLs from lookup services.
					org := strings.TrimSpace(report.Org)
					if len(org) > 0 && len(org) < 120 && !strings.ContainsAny(org, "\r\n<>") {
						result["provider"] = org
					}
				}
			}
			response.Body.Close()
		}
	}
	// 2MiB maximum; no upload, no custom target, and only after Admin clicks.
	download, err := http.NewRequestWithContext(context, http.MethodGet, "https://speed.cloudflare.com/__down?bytes=2097152", nil)
	if err == nil {
		begin := time.Now()
		response, reqErr := client.Do(download)
		if reqErr == nil {
			if response.StatusCode == http.StatusOK {
				size, _ := io.Copy(io.Discard, io.LimitReader(response.Body, 2097152))
				seconds := time.Since(begin).Seconds()
				if size >= 262144 && seconds > 0.001 {
					result["download_mbps"] = float64(size) * 8 / seconds / 1000000
				}
			}
			response.Body.Close()
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}
