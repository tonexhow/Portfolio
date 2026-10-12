package diagnostics

import (
	"context"
	"errors"
	"net"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// No database connection strings, driver errors or credentials appear in the
// public health response. These categories are deliberately coarse.
func FailureCode(err error) string {
	if err == nil {
		return ""
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "28P01", "28000":
			return "credentials_rejected"
		case "3D000":
			return "database_missing"
		case "42P01", "3F000", "42883":
			return "schema_unaligned"
		case "42501":
			return "database_permission_denied"
		}
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return "dns_failed"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "connection_timeout"
	}
	value := strings.ToLower(err.Error()) // classification only, never returned
	switch {
	case strings.Contains(value, "network is unreachable"), strings.Contains(value, "no route to host"), strings.Contains(value, "cannot assign requested address"):
		return "network_unreachable"
	case strings.Contains(value, "no such host"), strings.Contains(value, "name or service not known"):
		return "dns_failed"
	case strings.Contains(value, "password authentication failed"), strings.Contains(value, "authentication failed"):
		return "credentials_rejected"
	case strings.Contains(value, "schema"), strings.Contains(value, "portfolio information record is missing"), strings.Contains(value, "schema requires additive alignment"), strings.Contains(value, "apply database/"):
		return "schema_unaligned"
	case strings.Contains(value, "timeout"), strings.Contains(value, "deadline exceeded"):
		return "connection_timeout"
	default:
		return "database_unavailable"
	}
}

func FailureAdvice(code string) string {
	switch code {
	case "not_configured":
		return "DATABASE_URL is missing. Configure the server's private .env and restart Go."
	case "network_unreachable", "dns_failed", "connection_timeout":
		return "Check DNS and network connectivity. Supabase's direct database host may require IPv6; try its Session Pooler connection string from Dashboard > Connect, then restart Go."
	case "credentials_rejected":
		return "Verify the rotated PostgreSQL password and URL encoding in DATABASE_URL. Never put the database password in frontend config."
	case "schema_unaligned", "database_missing", "database_permission_denied":
		return "The database responded, but compatibility or permission checks failed. Review schema_version and the approved SQL migration before changing production data."
	case "database_query_failed":
		return "The database connection was created, but the readiness query failed. Check connectivity, permissions, and portfolio.sync_state."
	default:
		return "Verify DATABASE_URL, the Supabase database status, your network and schema version. Review private Go logs without sharing passwords."
	}
}
