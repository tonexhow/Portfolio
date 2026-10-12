//go:build !windows && !linux

package main

import "runtime"

func hostTelemetry() (model, osName string, totalRAM, availableRAM uint64, usage float64) {
	return runtime.GOARCH + " processor", runtime.GOOS, 0, 0, -1
}
