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

// Keep the legacy schema version unchanged so the still-live older Go server
// can connect to the same database after this additive migration.
const SchemaVersion = 4
const PublicProjectsMigration = "20261012_published_projects_rpc"
const PublicSnapshotMigration = "20261012_public_snapshot_rpc"
const ProjectOffersMigration = "20261012_project_offers_v1"
const LongChatMigration = "20261012_chat_12000_v1"
const ChatImagesMigration = "20261012_chat_images_v1"

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
	// Direct public Supabase reads are optional until the migration is
	// explicitly enabled. Keeping the legacy schema valid avoids breaking
	// the live site while the new frontend/UI is tested locally.
	var exists bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.personal_information WHERE id=1)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errors.New("portfolio information record is missing; schema alignment never seeds content")
	}
	return nil
}

// SchemaStatus inspects the existing database without modifying records.
func SchemaStatus(db *DB) (int, error) {
	var exists bool
	if err := db.QueryRow("SELECT to_regclass('portfolio.schema_version') IS NOT NULL").Scan(&exists); err != nil {
		return 0, errors.New("unable to inspect schema registry")
	}
	if !exists {
		return 0, nil
	}
	var version int
	if err := db.QueryRow("SELECT COALESCE(MAX(version),0) FROM portfolio.schema_version").Scan(&version); err != nil {
		return 0, errors.New("unable to read schema registry")
	}
	return version, nil
}

// SchemaShapeReady checks required core columns without reading or editing
// visitor content. The legacy version marker alone is insufficient to detect
// a partially applied older migration or missing Admin tables.
func SchemaShapeReady(db *DB) (bool, error) {
	required := map[string][]string{
		"schema_version":           {"version"},
		"schema_migrations":        {"migration_key"},
		"sync_state":               {"id", "revision"},
		"personal_information":     {"id", "content"},
		"projects":                 {"id", "name", "visible", "images_json"},
		"certificates":             {"id", "provider", "storage_url", "visible"},
		"career_profiles":          {"id", "title", "storage_url", "visible"},
		"feedback":                 {"id", "status"},
		"contact_messages":         {"id", "status"},
		"chat_threads":             {"id", "visitor_fingerprint", "last_message_at"},
		"chat_messages":            {"id", "body", "expires_at"},
		"chat_images":              {"id", "thread_id", "image_mime", "image_data", "expires_at"},
		"admin_sessions":           {"id", "token_hash", "expires_at"},
		"project_offers":           {"id", "price_centavos", "status", "contact_email", "acceptance_email_sent_at", "owner_name", "owner_provider", "archived_at", "admin_note"},
		"project_payment_attempts": {"id", "checkout_session_id", "status", "customer_email", "customer_phone", "archived_at"},
		"project_inquiries":        {"id", "thread_id", "title", "requested_centavos", "status", "offer_id"},
		"ai_provider_configs":      {"id", "provider", "key_ciphertext", "enabled"},
		"ai_reply_drafts":          {"id", "source_type", "message", "sent_at"},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='portfolio'`)
	if err != nil {
		return false, fmt.Errorf("cannot inspect database structure: %w", err)
	}
	defer rows.Close()
	found := make(map[string]map[string]bool)
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			return false, fmt.Errorf("cannot scan schema structure: %w", err)
		}
		if found[table] == nil {
			found[table] = make(map[string]bool)
		}
		found[table][column] = true
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("cannot inspect database structure: %w", err)
	}
	for table, columns := range required {
		for _, column := range columns {
			if !found[table][column] {
				return false, nil
			}
		}
	}
	return true, nil
}

// HasPublicProjectMigration is read-only and returns false for old databases.
func HasPublicProjectMigration(db *DB) (bool, error) {
	var exists bool
	if err := db.QueryRow("SELECT to_regclass('portfolio.schema_migrations') IS NOT NULL").Scan(&exists); err != nil {
		return false, errors.New("unable to inspect additive migration registry")
	}
	if !exists {
		return false, nil
	}
	var applied bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.schema_migrations WHERE migration_key=$1)", PublicProjectsMigration).Scan(&applied); err != nil {
		return false, errors.New("unable to read additive migration registry")
	}
	return applied, nil
}

// Ensure checks compatibility, applies only reviewed additive SQL when opted
// in, validates the function and existing data, then allows startup. The old
// database.schema_version stays at 4; old deployed Go servers remain compatible.
// No content/identity/chat table is renamed, truncated or deleted.
func Ensure(db *DB, root string, _ bool, autoMigrate bool) (bool, error) {
	version, err := SchemaStatus(db)
	if err != nil {
		return false, err
	}
	if version > SchemaVersion {
		return false, fmt.Errorf("legacy schema %d is newer than the supported base %d", version, SchemaVersion)
	}
	migrationApplied, rpcPresent := false, false
	if version == SchemaVersion {
		migrationApplied, err = HasPublicProjectMigration(db)
		if err != nil {
			return false, err
		}
		if err := db.QueryRow("SELECT to_regprocedure('public.jpano_public_projects()') IS NOT NULL").Scan(&rpcPresent); err != nil {
			return false, errors.New("unable to inspect published-project RPC")
		}
	}
	var snapshotPresent, snapshotRecorded bool
	if version == SchemaVersion {
		if err := db.QueryRow("SELECT to_regprocedure('public.jpano_public_snapshot()') IS NOT NULL").Scan(&snapshotPresent); err != nil {
			return false, errors.New("unable to inspect public snapshot RPC")
		}
		if exists, err := HasPublicProjectMigration(db); err == nil && exists {
			if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.schema_migrations WHERE migration_key=$1)", PublicSnapshotMigration).Scan(&snapshotRecorded); err != nil {
				return false, errors.New("unable to inspect snapshot migration registry")
			}
		}
	}
	var offersRecorded, offersTable bool
	if version == SchemaVersion {
		if err := db.QueryRow("SELECT to_regclass('portfolio.project_offers') IS NOT NULL").Scan(&offersTable); err != nil {
			return false, errors.New("cannot inspect project offers table")
		}
		if migrationApplied {
			if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.schema_migrations WHERE migration_key=$1)", ProjectOffersMigration).Scan(&offersRecorded); err != nil {
				return false, errors.New("cannot inspect project offers migration")
			}
		}
	}
	var longChatRecorded, chatImagesRecorded bool
	if version == SchemaVersion && migrationApplied {
		if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.schema_migrations WHERE migration_key=$1)", LongChatMigration).Scan(&longChatRecorded); err != nil {
			return false, errors.New("cannot inspect long-chat migration")
		}
	}
	if version == SchemaVersion && migrationApplied {
		if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.schema_migrations WHERE migration_key=$1)", ChatImagesMigration).Scan(&chatImagesRecorded); err != nil {
			return false, errors.New("cannot inspect chat-images migration")
		}
	}
	shapeReady := false
	if version == SchemaVersion {
		shapeReady, err = SchemaShapeReady(db)
		if err != nil {
			return false, err
		}
	}
	changed := false
	if version < SchemaVersion || !shapeReady || !migrationApplied || !rpcPresent || !snapshotPresent || !snapshotRecorded || !offersRecorded || !offersTable || !longChatRecorded || !chatImagesRecorded {
		if version == 0 && !autoMigrate {
			return false, errors.New("database schema is missing; review schema.sql and enable DB_AUTO_MIGRATE only after a database backup")
		}
		if version > 0 && !autoMigrate {
			// Preserve compatibility with older deployments for optional
			// public-only migrations. Missing core Admin tables/columns block
			// readiness instead of reporting a healthy database.
			if !shapeReady {
				return false, errors.New("schema requires additive alignment; enable DB_AUTO_MIGRATE after backup")
			}
			return false, Init(db)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := applySQLFile(ctx, db, filepath.Join(root, "database", "schema.sql")); err != nil {
			return false, fmt.Errorf("additive schema alignment failed (transaction rolled back): %w", err)
		}
		changed = true
	}
	if current, err := SchemaStatus(db); err != nil || current != SchemaVersion {
		return changed, fmt.Errorf("legacy schema not compatible: expected %d", SchemaVersion)
	}
	if changed {
		shapeReady, err = SchemaShapeReady(db)
		if err != nil || !shapeReady {
			return changed, errors.New("required schema columns are still missing after alignment")
		}
		if migrationApplied, err = HasPublicProjectMigration(db); err != nil || !migrationApplied {
			return changed, errors.New("public project migration record is still missing")
		}
		if err := db.QueryRow("SELECT to_regprocedure('public.jpano_public_snapshot()') IS NOT NULL").Scan(&snapshotPresent); err != nil || !snapshotPresent {
			return changed, errors.New("public snapshot RPC is still missing")
		}
	}
	var seeded bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM portfolio.personal_information WHERE id=1)").Scan(&seeded); err != nil {
		return changed, errors.New("cannot validate portfolio singleton")
	}
	if !seeded {
		// Never seed sample or private portfolio content as part of schema
		// alignment. A schema can exist while content is intentionally empty.
		return changed, errors.New("portfolio information record is missing; schema was checked but no portfolio data was generated")
	}
	if err := Init(db); err != nil {
		return changed, err
	}
	return changed, nil
}

// Align reapplies the idempotent schema definition, validates the expected
// schema version and singleton Information row. It never adds or deletes
// portfolio content, chat history or authentication/session records.
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
	// Alignment changes schema objects only; expired sessions and messages are
	// NOT deleted in this operation. Scheduled retention cleanup is separate.
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
		// schema.sql uses BEGIN/COMMIT. Explicitly roll back a failed
		// transaction so this pooled connection is not left aborted.
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = conn.ExecContext(rollbackCtx, "ROLLBACK")
		cancel()
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
