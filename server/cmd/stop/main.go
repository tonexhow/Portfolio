package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"jpano.dev/portfolio/internal/config"
)

func main() {
	root, err := config.Root()
	if err != nil {
		fail(err)
	}
	pidPath := filepath.Join(root, "systems", ".jpano-api.pid")
	data, err := os.ReadFile(pidPath)
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		fail(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		_ = os.Remove(pidPath)
		fail(fmt.Errorf("invalid backend PID file"))
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		_ = os.Remove(pidPath)
		fail(err)
	}
	if err := process.Kill(); err != nil {
		_ = os.Remove(pidPath)
		return
	}
	_ = os.Remove(pidPath)
}

func fail(err error) {
	_, _ = fmt.Fprintln(os.Stderr, "JPano stop:", err)
	os.Exit(1)
}
