//go:build !linux && !windows && !darwin

package main

func hostDiskStats() (uint64, uint64, bool) { return 0, 0, false }
