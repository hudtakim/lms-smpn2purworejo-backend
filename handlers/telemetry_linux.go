//go:build linux

package handlers

import "syscall"

func getRAMUsagePct() int {
	var sysInfo syscall.Sysinfo_t
	syscall.Sysinfo(&sysInfo)
	totalMem := float64(sysInfo.Totalram) * float64(sysInfo.Unit)
	freeMem := float64(sysInfo.Freeram) * float64(sysInfo.Unit)
	if totalMem == 0 {
		return 0
	}
	return int((totalMem - freeMem) / totalMem * 100)
}
