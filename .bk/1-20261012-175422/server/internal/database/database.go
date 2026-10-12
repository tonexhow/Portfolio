// Package database owns PostgreSQL connections and the small positional-parameter adapter
// used by the existing moderation queries. There is no SQLite runtime or fallback database.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type DB struct{ *sql.DB }
type Tx struct{ *sql.Tx }

const SchemaVersion = 4

func Open(connection string) (*DB, error) {
	u, err := url.Parse(connection)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" {
		return nil, errors.New("DATABASE_URL must be a PostgreSQL connection URL")
	}
	q := u.Query()
	q.Set("search_path", "portfolio,public")
	q.Set("connect_timeout", "8")
	q.Set("statement_timeout", "12000")
	if q.Get("sslmode") == "" {
		if u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1" {
			q.Set("sslmode", "disable")
		} else {
			q.Set("sslmode", "require")
		}
	}
	u.RawQuery = q.Encode()
	raw, err := sql.Open("pgx", u.String())
	if err != nil {
		return nil, err
	}
	raw.SetMaxOpenConns(envInt("DB_MAX_OPEN_CONNS", 5, 1, 50))
	raw.SetMaxIdleConns(envInt("DB_MAX_IDLE_CONNS", 2, 0, 20))
	raw.SetConnMaxLifetime(30 * time.Minute)
	raw.SetConnMaxIdleTime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = raw.PingContext(ctx); err != nil {
		raw.Close()
		return nil, err
	}
	return &DB{raw}, nil
}
func Init(db *DB) error {
	var version int
	if err := db.QueryRow("SELECT MAX(version) FROM portfolio.schema_version").Scan(&version); err != nil {
		return errors.New("apply database/schema.sql first")
	}
	if version != SchemaVersion {
		return errors.New("database schema version does not match this application")
	}
	var exists bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.personal_information WHERE id=1)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errors.New("apply database/initial_data.sql first")
	}
	return nil
}

// Ensure initializes an empty Supabase/PostgreSQL database from the checked-in
// schema and seed when autoSetup is enabled. Existing initialized databases are
// only validated; normal application startup never resets or overwrites data.
func Ensure(db *DB, root string, autoSetup bool) (bool, error) {
	if err := Init(db); err == nil {
		return false, nil
	}
	if !autoSetup {
		return false, errors.New("database schema/data is not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var schemaTable bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('portfolio.schema_version') IS NOT NULL").Scan(&schemaTable); err != nil {
		return false, errors.New("unable to inspect database schema")
	}
	changed := false
	// schema.sql is idempotent and also carries forward additive migrations.
	// When auto-setup is enabled, apply it whenever validation failed so an
	// existing older portfolio schema upgrades before the version check.
	if !schemaTable || autoSetup {
		if err := applySQLFile(ctx, db, filepath.Join(root, "database", "schema.sql")); err != nil {
			return false, fmt.Errorf("apply database/schema.sql: %w", err)
		}
		changed = true
	}

	var version int
	if err := db.QueryRowContext(ctx, "SELECT MAX(version) FROM portfolio.schema_version").Scan(&version); err != nil {
		return changed, errors.New("database schema is incomplete")
	}
	if version != SchemaVersion {
		return changed, errors.New("database schema version does not match this application")
	}

	var seeded bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM portfolio.personal_information WHERE id=1)").Scan(&seeded); err != nil {
		return changed, errors.New("unable to inspect initial portfolio data")
	}
	if !seeded {
		if err := applySQLFile(ctx, db, filepath.Join(root, "database", "initial_data.sql")); err != nil {
			return changed, fmt.Errorf("apply database/initial_data.sql: %w", err)
		}
		changed = true
	}
	if err := Init(db); err != nil {
		return changed, err
	}
	return changed, nil
}

// Align reapplies the idempotent schema definition, validates the expected
// schema version and singleton Information row, then clears only expired
// authentication/session records. It never drops portfolio content.
func Align(db *DB, root string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := applySQLFile(ctx, db, filepath.Join(root, "database", "schema.sql")); err != nil {
		return fmt.Errorf("align database schema: %w", err)
	}
	var infoRows int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM portfolio.personal_information`).Scan(&infoRows); err != nil {
		return fmt.Errorf("inspect portfolio information: %w", err)
	}
	if infoRows != 1 {
		return fmt.Errorf("portfolio.personal_information must contain exactly one row; found %d", infoRows)
	}
	var singletonOK bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM portfolio.personal_information WHERE id=1 AND jsonb_typeof(content)='object')`).Scan(&singletonOK); err != nil {
		return fmt.Errorf("validate portfolio information singleton: %w", err)
	}
	if !singletonOK {
		return errors.New("portfolio.personal_information row 1 must contain one JSON object")
	}
	CleanupExpiredAccess(db)
	return Init(db)
}

func applySQLFile(ctx context.Context, db *DB, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	conn, err := db.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	// The first import contains existing image/history data and can be large.
	// Temporarily lift the normal 12-second statement limit on this one session.
	if _, err = conn.ExecContext(ctx, "SET statement_timeout = 0"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "SET statement_timeout = 12000")
	if _, err = conn.ExecContext(ctx, string(data)); err != nil {
		return err
	}
	return nil
}
func envInt(key string, fallback, low, high int) int {
	n, e := strconv.Atoi(os.Getenv(key))
	if e != nil {
		return fallback
	}
	return max(low, min(high, n))
}
func (d *DB) Exec(q string, args ...any) (sql.Result, error) { return d.DB.Exec(Bind(q), args...) }
func (d *DB) Query(q string, args ...any) (*sql.Rows, error) { return d.DB.Query(Bind(q), args...) }
func (d *DB) QueryRow(q string, args ...any) *sql.Row        { return d.DB.QueryRow(Bind(q), args...) }
func (d *DB) ExecContext(c context.Context, q string, args ...any) (sql.Result, error) {
	return d.DB.ExecContext(c, Bind(q), args...)
}
func (d *DB) QueryContext(c context.Context, q string, args ...any) (*sql.Rows, error) {
	return d.DB.QueryContext(c, Bind(q), args...)
}
func (d *DB) QueryRowContext(c context.Context, q string, args ...any) *sql.Row {
	return d.DB.QueryRowContext(c, Bind(q), args...)
}
func (d *DB) Begin() (*Tx, error) {
	t, e := d.DB.Begin()
	if e != nil {
		return nil, e
	}
	return &Tx{t}, nil
}
func (d *DB) BeginTx(c context.Context, o *sql.TxOptions) (*Tx, error) {
	t, e := d.DB.BeginTx(c, o)
	if e != nil {
		return nil, e
	}
	return &Tx{t}, nil
}
func (t *Tx) Exec(q string, args ...any) (sql.Result, error) { return t.Tx.Exec(Bind(q), args...) }
func (t *Tx) Query(q string, args ...any) (*sql.Rows, error) { return t.Tx.Query(Bind(q), args...) }
func (t *Tx) QueryRow(q string, args ...any) *sql.Row        { return t.Tx.QueryRow(Bind(q), args...) }
func CleanupExpiredAccess(db *DB) {
	now := time.Now()
	_, _ = db.Exec(`UPDATE access_requests SET status='expired',updated_at=$1 WHERE status IN ('pending','granted') AND expires_at<$1`, now)
	_, _ = db.Exec(`DELETE FROM access_requests WHERE created_at<$1 AND status IN ('completed','failed','expired')`, now.Add(-7*24*time.Hour))
	_, _ = db.Exec(`DELETE FROM admin_sessions WHERE expires_at<$1 OR (revoked_at IS NOT NULL AND revoked_at<$2)`, now, now.Add(-24*time.Hour))
	_, _ = db.Exec(`DELETE FROM feedback_auth_sessions WHERE expires_at<$1`, now)
	_, _ = db.Exec(`DELETE FROM contact_auth_sessions WHERE expires_at<$1`, now)
	_, _ = db.Exec(`DELETE FROM chat_messages WHERE expires_at<$1`, now)
	_, _ = db.Exec(`DELETE FROM chat_threads t WHERE t.updated_at<$1 AND NOT EXISTS(SELECT 1 FROM chat_messages m WHERE m.thread_id=t.id)`, now.Add(-7*24*time.Hour))
}

// Bind accepts conventional ? parameters in older query builders and emits native
// PostgreSQL $n parameters. Quoted literals, identifiers and SQL comments are preserved.
// New queries can use $n directly. Do not mix both styles or use a bare JSON ? operator.
func Bind(q string) string {
	if !strings.Contains(q, "?") {
		return q
	}
	var b strings.Builder
	n := 0
	for i := 0; i < len(q); {
		if q[i] == '\'' || q[i] == '"' {
			quote := q[i]
			b.WriteByte(q[i])
			i++
			for i < len(q) {
				ch := q[i]
				b.WriteByte(ch)
				i++
				if ch == quote {
					if i < len(q) && q[i] == quote {
						b.WriteByte(q[i])
						i++
						continue
					}
					break
				}
			}
			continue
		}
		if i+1 < len(q) && q[i:i+2] == "--" {
			j := strings.IndexByte(q[i:], '\n')
			if j < 0 {
				b.WriteString(q[i:])
				break
			}
			b.WriteString(q[i : i+j+1])
			i += j + 1
			continue
		}
		if i+1 < len(q) && q[i:i+2] == "/*" {
			j := strings.Index(q[i+2:], "*/")
			if j < 0 {
				b.WriteString(q[i:])
				break
			}
			j += i + 4
			b.WriteString(q[i:j])
			i = j
			continue
		}
		if q[i] == '$' {
			j := i + 1
			for j < len(q) && ((q[j] >= 'a' && q[j] <= 'z') || (q[j] >= 'A' && q[j] <= 'Z') || q[j] == '_') {
				j++
			}
			if j < len(q) && q[j] == '$' {
				tag := q[i : j+1]
				end := strings.Index(q[j+1:], tag)
				if end >= 0 {
					end += j + 1 + len(tag)
					b.WriteString(q[i:end])
					i = end
					continue
				}
			}
		}
		if q[i] == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		} else {
			b.WriteByte(q[i])
		}
		i++
	}
	return b.String()
}
