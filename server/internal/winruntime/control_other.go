//go:build !windows

package winruntime

import "errors"

func WatchStop() (<-chan struct{}, func(), error) { return nil, func() {}, nil }
func SignalStop() (bool, error)                   { return false, errors.New("stop event is available only on Windows") }
func StopVerifiedPID(uint32, string, uintptr) (bool, error) {
	return false, errors.New("process stop is available only on Windows")
}
