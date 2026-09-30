package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOrigins(t *testing.T) {
	for _, s := range []string{"https://jpano.dev", "https://api.jpano.dev", "http://localhost:3000"} {
		if !ValidOrigin(s) {
			t.Errorf("rejected %s", s)
		}
	}
	for _, s := range []string{"https://jpano.dev/path", "https://user:secret@jpano.dev", "javascript:alert(1)", "https://jpano.dev?x=1", "https://jpano.dev#test", "*"} {
		if ValidOrigin(s) {
			t.Errorf("accepted %s", s)
		}
	}
}
func TestEnvDoesNotReplaceProcessSettings(t *testing.T) {
	t.Setenv("PORTFOLIO_ENV_TEST", "process")
	p := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(p, []byte("PORTFOLIO_ENV_TEST=from-file\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := loadEnv(p); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("PORTFOLIO_ENV_TEST") != "process" {
		t.Fatal("process environment was replaced")
	}
}
