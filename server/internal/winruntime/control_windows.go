//go:build windows

// Package winruntime coordinates the packaged silent Windows backend and its
// companion stop.exe without exposing a privileged HTTP shutdown endpoint.
package winruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	errorAlreadyExists             syscall.Errno = 183
	errorFileNotFound              syscall.Errno = 2
	eventModifyState               uintptr       = 0x0002
	synchronize                    uintptr       = 0x00100000
	processQueryLimitedInformation uintptr       = 0x1000
	processTerminate               uintptr       = 0x0001
	waitObject0                    uintptr       = 0
	waitTimeout                    uintptr       = 258
	infinite                       uintptr       = 0xFFFFFFFF
)

var (
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	createEvent         = kernel32.NewProc("CreateEventW")
	openEvent           = kernel32.NewProc("OpenEventW")
	setEvent            = kernel32.NewProc("SetEvent")
	waitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	closeHandle         = kernel32.NewProc("CloseHandle")
	openProcess         = kernel32.NewProc("OpenProcess")
	queryProcessPath    = kernel32.NewProc("QueryFullProcessImageNameW")
	terminateProcess    = kernel32.NewProc("TerminateProcess")
)

func eventName() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	// exe folder is identical for jpano-portfolio.exe and stop.exe.
	sum := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(filepath.Dir(exe)))))
	return `Local\JPanoPortfolioStop_` + hex.EncodeToString(sum[:12]), nil
}

func winError(action string, err error) error {
	if err == nil || err == syscall.Errno(0) {
		return fmt.Errorf("%s failed", action)
	}
	return fmt.Errorf("%s: %w", action, err)
}

// WatchStop creates a single-instance named Windows event. Its channel is
// closed when the matching installation's stop.exe signals the event.
func WatchStop() (<-chan struct{}, func(), error) {
	name, err := eventName()
	if err != nil {
		return nil, nil, err
	}
	ptr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return nil, nil, err
	}
	handle, _, callErr := createEvent.Call(0, 1, 0, uintptr(unsafe.Pointer(ptr)))
	if handle == 0 {
		return nil, nil, winError("CreateEvent", callErr)
	}
	if callErr == errorAlreadyExists {
		closeHandle.Call(handle)
		return nil, nil, errors.New("another JPano backend is already running from this folder")
	}
	ch := make(chan struct{})
	go func() {
		result, _, _ := waitForSingleObject.Call(handle, infinite)
		if result == waitObject0 {
			close(ch)
		} else {
			log.Printf("Windows stop event wait failed (%d)", result)
		}
	}()
	return ch, func() { closeHandle.Call(handle) }, nil
}

// SignalStop requests a graceful stop from the matching installed executable.
// This event cannot stop an unrelated application or a different JPano folder.
func SignalStop() (bool, error) {
	name, err := eventName()
	if err != nil {
		return false, err
	}
	ptr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return false, err
	}
	h, _, callErr := openEvent.Call(eventModifyState, 0, uintptr(unsafe.Pointer(ptr)))
	if h == 0 {
		if callErr == errorFileNotFound {
			return false, nil
		}
		return false, winError("OpenEvent", callErr)
	}
	defer closeHandle.Call(h)
	ok, _, callErr := setEvent.Call(h)
	if ok == 0 {
		return false, winError("SetEvent", callErr)
	}
	return true, nil
}

// StopVerifiedPID waits for graceful exit then forces termination only if the
// PID points to the exact expected jpano-portfolio.exe path. This protects
// unrelated processes against stale/reused PID files.
func StopVerifiedPID(pid uint32, expectedExe string, timeoutMS uintptr) (bool, error) {
	if pid == 0 {
		return false, errors.New("invalid process ID")
	}
	h, _, callErr := openProcess.Call(processQueryLimitedInformation|processTerminate|synchronize, 0, uintptr(pid))
	if h == 0 {
		if callErr == errorFileNotFound || callErr == syscall.Errno(87) {
			return false, nil
		}
		return false, winError("OpenProcess", callErr)
	}
	defer closeHandle.Call(h)
	path := make([]uint16, 32768)
	n := uint32(len(path))
	ok, _, callErr := queryProcessPath.Call(h, 0, uintptr(unsafe.Pointer(&path[0])), uintptr(unsafe.Pointer(&n)))
	if ok == 0 {
		return false, winError("QueryFullProcessImageName", callErr)
	}
	actual := filepath.Clean(syscall.UTF16ToString(path[:n]))
	expected, err := filepath.Abs(expectedExe)
	if err != nil {
		return false, err
	}
	if !strings.EqualFold(actual, filepath.Clean(expected)) {
		return false, fmt.Errorf("refusing to stop PID %d: executable does not match this installation", pid)
	}
	state, _, _ := waitForSingleObject.Call(h, timeoutMS)
	if state == waitObject0 {
		return false, nil
	} // already exited gracefully
	if state != waitTimeout {
		return false, fmt.Errorf("WaitForSingleObject returned %d", state)
	}
	ok, _, callErr = terminateProcess.Call(h, 1)
	if ok == 0 {
		return false, winError("TerminateProcess", callErr)
	}
	final, _, _ := waitForSingleObject.Call(h, 3000)
	if final != waitObject0 {
		return true, errors.New("forced termination requested, but exit not confirmed")
	}
	return true, nil
}
