//go:build linux

package main

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

var cpuCounter = struct {
	sync.Mutex
	total, idle uint64
}{}

func hostTelemetry() (model, osName string, totalRAM, availableRAM uint64, usage float64) {
	model = "CPU model unavailable"
	osName = "Linux"
	usage = -1
	if raw, e := os.ReadFile("/proc/cpuinfo"); e == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if strings.HasPrefix(line, "model name") {
				if pair := strings.SplitN(line, ":", 2); len(pair) == 2 {
					model = strings.TrimSpace(pair[1])
					break
				}
			}
		}
	}
	if raw, e := os.ReadFile("/etc/os-release"); e == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				osName = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
				break
			}
		}
	}
	if raw, e := os.ReadFile("/proc/meminfo"); e == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			n, _ := strconv.ParseUint(fields[1], 10, 64)
			if strings.HasPrefix(line, "MemTotal:") {
				totalRAM = n * 1024
			}
			if strings.HasPrefix(line, "MemAvailable:") {
				availableRAM = n * 1024
			}
		}
	}
	if raw, e := os.ReadFile("/proc/stat"); e == nil {
		lines := strings.SplitN(string(raw), "\n", 2)
		fields := strings.Fields(lines[0])
		if len(fields) >= 5 && fields[0] == "cpu" {
			var total, idle uint64
			for i := 1; i < len(fields); i++ {
				n, _ := strconv.ParseUint(fields[i], 10, 64)
				total += n
				if i == 4 || i == 5 {
					idle += n
				}
			}
			cpuCounter.Lock()
			if cpuCounter.total > 0 && total > cpuCounter.total {
				dTotal := total - cpuCounter.total
				dIdle := idle - cpuCounter.idle
				if dIdle <= dTotal {
					usage = float64(dTotal-dIdle) / float64(dTotal) * 100
				}
			}
			cpuCounter.total = total
			cpuCounter.idle = idle
			cpuCounter.Unlock()
		}
	}
	if model == "CPU model unavailable" {
		model = runtime.GOARCH + " processor"
	}
	return
}
