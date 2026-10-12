//go:build linux

package main

import "syscall"

func hostDiskStats() (uint64, uint64, bool) {
	var stat syscall.Statfs_t
	if syscall.Statfs("/", &stat) != nil {
		return 0, 0, false
	}
	return stat.Blocks * uint64(stat.Bsize), stat.Bavail * uint64(stat.Bsize), true
}
