package main

// Read-only, paged, allowlisted row inspector. No SQL editor or unrestricted
// table dump. Ciphertext, credentials and binary columns are never fetched.
import (
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var safeTableName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)

func quotedSQLName(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }
func redactDatabaseColumn(name, kind string) bool {
	s := strings.ToLower(name)
	for _, needle := range []string{"password", "secret", "token", "cipher", "private_key", "api_key", "credential", "access_key", "encryption", "hash", "image_data", "image_blob", "binary", "session_cookie", "oauth_code", "browser_secret"} {
		if strings.Contains(s, needle) {
			return true
		}
	}
	t := strings.ToLower(kind)
	return strings.Contains(t, "bytea")
}
func (a *app) adminDatabaseRows(w http.ResponseWriter, r *http.Request) {
	schema, table := r.PathValue("schema"), r.PathValue("table")
	if (schema != "portfolio" && schema != "public") || !safeTableName.MatchString(table) {
		writeError(w, 400, "Unsupported database table.")
		return
	}
	var exists bool
	err := a.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind='r')`, schema, table).Scan(&exists)
	if err != nil || !exists {
		writeError(w, 404, "Table is not available.")
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position LIMIT 80`, schema, table)
	if err != nil {
		writeError(w, 503, "Unable to inspect table columns.")
		return
	}
	type column struct {
		name   string
		hidden bool
	}
	columns := []column{}
	for rows.Next() {
		var name, kind string
		if rows.Scan(&name, &kind) != nil {
			continue
		}
		columns = append(columns, column{name, redactDatabaseColumn(name, kind)})
	}
	failure := rows.Err()
	rows.Close()
	if failure != nil {
		writeError(w, 503, "Unable to finish reading table columns.")
		return
	}
	if len(columns) == 0 {
		writeError(w, 503, "No inspectable columns were found.")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 1000 {
		page = 1000
	}
	const limit = 20
	parts := make([]string, len(columns))
	labels := make([]map[string]any, 0, len(columns))
	for i, c := range columns {
		if c.hidden {
			parts[i] = `'[redacted]'::text`
		} else {
			parts[i] = `LEFT(COALESCE(` + quotedSQLName(c.name) + `::text,''),500)`
		}
		labels = append(labels, map[string]any{"name": c.name, "redacted": c.hidden})
	}
	query := `SELECT ` + strings.Join(parts, ",") + ` FROM ` + quotedSQLName(schema) + `.` + quotedSQLName(table) + ` ORDER BY ctid LIMIT $1 OFFSET $2`
	content, err := a.db.QueryContext(r.Context(), query, limit+1, (page-1)*limit)
	if err != nil {
		writeError(w, 503, "Unable to read rows from this table.")
		return
	}
	defer content.Close()
	items := make([][]string, 0, limit+1)
	for content.Next() {
		vals := make([]sql.NullString, len(columns))
		dest := make([]any, len(columns))
		for i := range vals {
			dest[i] = &vals[i]
		}
		if content.Scan(dest...) != nil {
			writeError(w, 503, "Unable to read a table row.")
			return
		}
		row := make([]string, len(columns))
		for i, v := range vals {
			if v.Valid {
				row[i] = v.String
			} else {
				row[i] = "—"
			}
		}
		items = append(items, row)
	}
	if content.Err() != nil {
		writeError(w, 503, "Database row inspection interrupted.")
		return
	}
	more := len(items) > limit
	if more {
		items = items[:limit]
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, map[string]any{"schema": schema, "table": table, "page": page, "page_size": limit, "has_next": more, "columns": labels, "rows": items, "read_only": true})
}
