//go:build windows

package main

import (
	"os"
	"syscall"
	"unsafe"
)

func hostDiskStats() (uint64, uint64, bool) {
	root := os.Getenv("SystemDrive")
	if len(root) < 2 {
		root = "C:"
	}
	path, e := syscall.UTF16PtrFromString(root + "\\")
	if e != nil {
		return 0, 0, false
	}
	kernel := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel.NewProc("GetDiskFreeSpaceExW")
	var free, total, totalFree uint64
	ok, _, _ := proc.Call(uintptr(unsafe.Pointer(path)), uintptr(unsafe.Pointer(&free)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
	return total, free, ok != 0
}
