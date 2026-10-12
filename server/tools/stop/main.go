// stop.exe: a console-free local shutdown tool for the Windows distribution.
package main

import (
	"fmt"
	"jpano.dev/portfolio/internal/winruntime"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func main() {
	closeLog := winruntime.StartFileLog()
	defer closeLog()
	root := winruntime.PackagedRoot()
	if root == "" {
		log.Print("stop.exe must run from system/windows in a packaged release")
		return
	}
	pidFile := filepath.Join(root, "system", "windows", ".jpano-api.pid")
	content, err := os.ReadFile(pidFile)
	if err != nil {
		if os.IsNotExist(err) {
			log.Print("JPano server is not running (PID file absent)")
			return
		}
		log.Printf("Cannot read JPano PID file: %v", err)
		return
	}
	number, err := strconv.ParseUint(strings.TrimSpace(string(content)), 10, 32)
	if err != nil || number == 0 {
		log.Print("Invalid JPano PID file; refusing to stop another process")
		return
	}
	// Signal first for graceful shutdown and flushing; force only when a
	// verified binary is still alive after the grace interval.
	signaled, err := winruntime.SignalStop()
	if err != nil {
		log.Printf("Unable to send graceful stop signal: %v", err)
	}
	expected := filepath.Join(root, "system", "windows", "jpano-portfolio.exe")
	forced, err := winruntime.StopVerifiedPID(uint32(number), expected, 12000)
	if err != nil {
		log.Printf("JPano stop failed: %v", err)
		return
	}
	if forced {
		log.Print("JPano backend force-stopped after graceful timeout")
	}
	if !forced {
		log.Printf("JPano backend stopped (%s)", map[bool]string{true: "gracefully", false: "already stopped"}[signaled])
	}
	// A terminated process cannot remove its own PID file.
	if forced {
		if err := os.Remove(pidFile); err != nil && !os.IsNotExist(err) {
			log.Print(fmt.Errorf("could not clean stale PID file: %w", err))
		}
	}
}
