package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Settings struct {
	Root, ClientDir, FrontendPort, BackendPort, Bind, FrontendOrigin, APIOrigin, DatabaseURL string
	Origins                                                                                  map[string]bool
}

func Root() (string, error) {
	if value := os.Getenv("PROJECT_ROOT"); value != "" {
		p, e := filepath.Abs(value)
		if e != nil {
			return "", e
		}
		if validRoot(p) {
			return p, nil
		}
		return "", errors.New("PROJECT_ROOT must be a source checkout or compiled JPano backend root")
	}
	cwd, _ := os.Getwd()
	exe, _ := os.Executable()
	for _, start := range []string{cwd, filepath.Dir(exe)} {
		for d := start; d != ""; d = filepath.Dir(d) {
			if validRoot(d) {
				return d, nil
			}
			if filepath.Dir(d) == d {
				break
			}
		}
	}
	return "", errors.New("start inside the JPano source/release folder or set PROJECT_ROOT")
}
func validRoot(p string) bool {
	// Source checkout: client/ + server/go.mod.
	if a, e := os.Stat(filepath.Join(p, "client")); e == nil && a.IsDir() {
		if _, e = os.Stat(filepath.Join(p, "server", "go.mod")); e == nil {
			return true
		}
	}
	// Compiled backend distribution: .env + database/schema.sql.
	if _, e := os.Stat(filepath.Join(p, ".env")); e != nil {
		return false
	}
	if _, e := os.Stat(filepath.Join(p, "database", "schema.sql")); e != nil {
		return false
	}
	return true
}
func Load() (Settings, error) {
	var c Settings
	root, err := Root()
	if err != nil {
		return c, err
	}
	c.Root = root
	c.ClientDir = filepath.Join(root, "client")
	if err = loadEnv(filepath.Join(root, ".env")); err != nil {
		return c, err
	}
	c.FrontendPort = env("FRONTEND_PORT", "3000")
	c.BackendPort = env("BACKEND_PORT", "8080")
	c.Bind = env("BACKEND_BIND", "127.0.0.1")
	for _, p := range []string{c.FrontendPort, c.BackendPort} {
		n, e := strconv.Atoi(p)
		if e != nil || n < 1 || n > 65535 {
			return c, errors.New("ports must be integers from 1 to 65535")
		}
	}
	if c.FrontendPort == c.BackendPort {
		return c, errors.New("FRONTEND_PORT and BACKEND_PORT must differ")
	}
	c.FrontendOrigin = strings.TrimRight(env("FRONTEND_ORIGIN", "http://127.0.0.1:"+c.FrontendPort), "/")
	c.APIOrigin = strings.TrimRight(env("API_ORIGIN", "http://127.0.0.1:"+c.BackendPort), "/")
	c.DatabaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	c.Origins = map[string]bool{}
	for _, origin := range append([]string{c.FrontendOrigin}, strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",")...) {
		origin = strings.TrimSpace(strings.TrimRight(origin, "/"))
		if origin == "" {
			continue
		}
		if !ValidOrigin(origin) {
			return c, fmt.Errorf("invalid CORS origin: %s", origin)
		}
		c.Origins[origin] = true
	}
	if !ValidOrigin(c.APIOrigin) {
		return c, errors.New("API_ORIGIN must be a complete HTTP(S) origin with no path")
	}
	if env("COOKIE_SAME_SITE", "lax") == "none" && !strings.HasPrefix(c.APIOrigin, "https://") {
		return c, errors.New("COOKIE_SAME_SITE=none requires an HTTPS API_ORIGIN")
	}
	return c, nil
}
func ValidOrigin(value string) bool {
	u, e := url.Parse(value)
	return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}
func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
func loadEnv(path string) error {
	data, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
			v = v[1 : len(v)-1]
		}
		if _, exists := os.LookupEnv(k); !exists && k != "" {
			_ = os.Setenv(k, v)
		}
	}
	return nil
}
