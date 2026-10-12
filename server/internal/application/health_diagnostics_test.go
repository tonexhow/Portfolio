package application

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestDatabaseFailureCategories(t *testing.T) {
	tests := []struct {
		err  error
		want string
	}{
		{&pgconn.PgError{Code: "28P01"}, "credentials_rejected"},
		{&pgconn.PgError{Code: "42P01"}, "schema_unaligned"},
		{errors.New("network is unreachable"), "network_unreachable"},
		{errors.New("i/o timeout"), "connection_timeout"},
		{errors.New("unknown error"), "database_unavailable"},
	}
	for _, x := range tests {
		if got := databaseFailureCode(x.err); got != x.want {
			t.Errorf("code=%s, want=%s", got, x.want)
		}
		if advice := databaseFailureAdvice(x.want); len(advice) < 10 {
			t.Errorf("missing advice for %s", x.want)
		}
	}
}
func TestDatabaseHealthNeverLeaksSecret(t *testing.T) {
	secret := "postgresql://postgres:SUPER-SECRET-PASSWORD@host.invalid/postgres"
	code := databaseFailureCode(errors.New("driver connection error " + secret))
	if strings.Contains(databaseFailureAdvice(code), "SUPER-SECRET") || strings.Contains(code, "SUPER-SECRET") {
		t.Fatal("database health exposed a connection secret")
	}
}
