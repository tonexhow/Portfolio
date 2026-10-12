// JPano Go backend entrypoint. Keep this beside go.mod for `cd server && go run .`.
package main

import (
	"jpano.dev/portfolio/internal/application"
	"jpano.dev/portfolio/internal/winruntime"
	"log"
)

func main() {
	closeLog := winruntime.StartFileLog()
	defer closeLog()
	stopChannel, closeEvent, err := winruntime.WatchStop()
	if err != nil {
		log.Fatalf("JPano cannot start: %v", err)
	}
	defer closeEvent()
	application.RunWithStop(stopChannel)
}
