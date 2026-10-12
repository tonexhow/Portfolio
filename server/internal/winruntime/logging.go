package winruntime

import (
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// PackagedRoot locates the distribution beside system/windows, regardless of
// the shortcut's Start in directory. It returns empty for go run . and tests.
func PackagedRoot() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	folder := filepath.Dir(exe)
	if !strings.EqualFold(filepath.Base(folder), "windows") || !strings.EqualFold(filepath.Base(filepath.Dir(folder)), "system") {
		return ""
	}
	return filepath.Dir(filepath.Dir(folder))
}

// StartFileLog writes a persistent log even when the process has no console.
// Only packaged Windows binaries write root/logs.txt. App diagnostics remain
// protected by the existing admin authorization and bounded in-memory log.
func StartFileLog() func() {
	root := PackagedRoot()
	if root == "" {
		return func() {}
	}
	f, err := os.OpenFile(filepath.Join(root, "logs.txt"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return func() {}
	}
	os.Stdout = f
	os.Stderr = f
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.LUTC)
	log.Printf("JPano Windows runtime starting (%s)", time.Now().UTC().Format(time.RFC3339))
	return func() { log.Print("JPano Windows runtime finished"); _ = f.Close() }
}
