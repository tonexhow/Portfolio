//go:build windows

package main

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type cpuFileTime struct{ LowDateTime, HighDateTime uint32 }

func cpuTicks(t cpuFileTime) uint64 { return uint64(t.HighDateTime)<<32 | uint64(t.LowDateTime) }

var winMetricsKernel = syscall.NewLazyDLL("kernel32.dll")
var winGetSystemTimes = winMetricsKernel.NewProc("GetSystemTimes")
var winMemoryStatus = winMetricsKernel.NewProc("GlobalMemoryStatusEx")

type winMemoryEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

var windowsProcessorName = struct {
	sync.Once
	name string
}{}

func realWindowsCPUName() string {
	windowsProcessorName.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer cancel()
		output, err := exec.CommandContext(ctx, "reg", "query", `HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0`, "/v", "ProcessorNameString").Output()
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(output), "\n") {
			if strings.Contains(line, "ProcessorNameString") && strings.Contains(line, "REG_SZ") {
				words := strings.SplitN(line, "REG_SZ", 2)
				if len(words) == 2 && strings.TrimSpace(words[1]) != "" {
					windowsProcessorName.name = strings.TrimSpace(words[1])
					break
				}
			}
		}
	})
	return windowsProcessorName.name
}

var winCPUCounter = struct {
	sync.Mutex
	total, idle uint64
}{}

func hostTelemetry() (model, osName string, totalRAM, availableRAM uint64, usage float64) {
	model = realWindowsCPUName()
	if model == "" {
		model = os.Getenv("PROCESSOR_IDENTIFIER")
	}
	if model == "" {
		model = runtime.GOARCH + " processor"
	}
	osName = "Windows"
	usage = -1
	var idle, kernel, user cpuFileTime
	ok, _, _ := winGetSystemTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
	if ok != 0 {
		total := cpuTicks(kernel) + cpuTicks(user)
		idleValue := cpuTicks(idle)
		winCPUCounter.Lock()
		if winCPUCounter.total > 0 && total > winCPUCounter.total {
			dTotal := total - winCPUCounter.total
			dIdle := idleValue - winCPUCounter.idle
			if dIdle <= dTotal {
				usage = float64(dTotal-dIdle) / float64(dTotal) * 100
			}
		}
		winCPUCounter.total = total
		winCPUCounter.idle = idleValue
		winCPUCounter.Unlock()
	}
	memory := winMemoryEx{Length: uint32(unsafe.Sizeof(winMemoryEx{}))}
	if ok, _, _ := winMemoryStatus.Call(uintptr(unsafe.Pointer(&memory))); ok != 0 {
		totalRAM = memory.TotalPhys
		availableRAM = memory.AvailPhys
	}
	return
}
