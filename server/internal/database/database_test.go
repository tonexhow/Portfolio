package database

import "testing"

func TestBind(t *testing.T) {
	cases := map[string]string{
		`SELECT * FROM projects WHERE id=? AND visible=?`: `SELECT * FROM projects WHERE id=$1 AND visible=$2`,
		`SELECT '?' AS "?", 'it''s?' WHERE id=?`:          `SELECT '?' AS "?", 'it''s?' WHERE id=$1`,
		"SELECT ? -- ignored ?\n, ?":                      "SELECT $1 -- ignored ?\n, $2",
		`SELECT /* ignored ? */ ?`:                        `SELECT /* ignored ? */ $1`,
		`SELECT $$ ? $$, $body$ ? $body$, ?`:              `SELECT $$ ? $$, $body$ ? $body$, $1`,
		`SELECT * FROM projects WHERE id=$1`:              `SELECT * FROM projects WHERE id=$1`,
	}
	for input, want := range cases {
		if got := Bind(input); got != want {
			t.Errorf("Bind(%q)=%q; want %q", input, got, want)
		}
	}
}
func TestInvalidConnectionURL(t *testing.T) {
	for _, value := range []string{"", "sqlite:///private.db", "https://example.com", "postgres://"} {
		if _, err := Open(value); err == nil {
			t.Errorf("accepted invalid connection %q", value)
		}
	}
}
