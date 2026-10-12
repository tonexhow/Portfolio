package main

// Read-only management diagnostics. No SQL editor, command execution, arbitrary
// filesystem reads, plaintext secrets, or public diagnostic endpoints.
import (
	"bytes"
	"io"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

var serverBootedAt = time.Now()
var managementActivity = struct {
	sync.Mutex
	lines []string
}{lines: make([]string, 0, 50)}

// Log capture only stores pre-formatted application logging; it deliberately
// excludes any line with credential-like material before presentation.
type boundedLogWriter struct{}

func (boundedLogWriter) Write(p []byte) (int, error) {
	for _, line := range bytes.Split(p, []byte{'\n'}) {
		s := strings.TrimSpace(string(line))
		if s == "" {
			continue
		}
		low := strings.ToLower(s)
		if len(s) > 280 || strings.Contains(low, "authorization") || strings.Contains(low, "password") || strings.Contains(low, "secret") || strings.Contains(low, "token=") || strings.Contains(low, "?code=") || strings.Contains(low, "apikey") || strings.Contains(low, "api_key") || strings.Contains(low, ".env") {
			continue
		}
		managementActivity.Lock()
		managementActivity.lines = append(managementActivity.lines, s)
		if len(managementActivity.lines) > 50 {
			managementActivity.lines = managementActivity.lines[len(managementActivity.lines)-50:]
		}
		managementActivity.Unlock()
	}
	return len(p), nil
}
func enableManagementLog(w io.Writer) { log.SetOutput(io.MultiWriter(w, boundedLogWriter{})) }

func (a *app) adminServerInfo(w http.ResponseWriter, r *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	provider := strings.TrimSpace(os.Getenv("HOSTING_PROVIDER"))
	if provider == "" {
		provider = "Self-hosted / unspecified"
	}
	if len(provider) > 70 {
		provider = provider[:70]
	}
	cpuModel, osName, totalRAM, availableRAM, cpuLoad := hostTelemetry()
	diskTotal, diskFree, diskOK := hostDiskStats()
	diskState := "Host storage usage unavailable on this platform"
	if diskOK {
		diskState = "Available"
	}
	payload := map[string]any{"online": true, "started_at": serverBootedAt, "uptime_seconds": int64(time.Since(serverBootedAt).Seconds()), "hosting": provider, "platform": runtime.GOOS, "architecture": runtime.GOARCH, "cpu_logical": runtime.NumCPU(), "cpu_model": cpuModel, "os_name": osName, "cpu_usage_percent": cpuLoad, "ram_available_bytes": availableRAM, "ram_total_bytes": totalRAM, "ram_process_bytes": mem.Sys, "goroutines": runtime.NumGoroutine(), "gpu": "Not available from portable server telemetry", "storage": diskState, "storage_total_bytes": diskTotal, "storage_free_bytes": diskFree, "internet": "Inbound service active; outbound bandwidth not measured", "database_connected": a.db != nil}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, payload)
}
func (a *app) adminServerLogs(w http.ResponseWriter, r *http.Request) {
	managementActivity.Lock()
	lines := append([]string{}, managementActivity.lines...)
	managementActivity.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"lines": lines, "limit": 50, "read_only": true})
}
func (a *app) adminDatabaseTables(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT n.nspname,c.relname,CASE WHEN c.reltuples < 0 THEN 0 ELSE c.reltuples::bigint END,pg_total_relation_size(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('portfolio','public') AND c.relkind='r' AND c.relname NOT LIKE 'pg_%' ORDER BY n.nspname,c.relname LIMIT 200`)
	if err != nil {
		writeError(w, 503, "Database inspection unavailable.")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var schema, name string
		var estimated, size int64
		if rows.Scan(&schema, &name, &estimated, &size) == nil {
			items = append(items, map[string]any{"schema": schema, "table": name, "estimated_rows": estimated, "bytes": size})
		}
	}
	if rows.Err() != nil {
		writeError(w, 503, "Database inspection interrupted.")
		return
	}
	var total int64
	_ = a.db.QueryRow(`SELECT pg_database_size(current_database())`).Scan(&total)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"items": items, "storage_bytes": total, "table_count": len(items), "read_only": true, "counts": "estimates"})
}
