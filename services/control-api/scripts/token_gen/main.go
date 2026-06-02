// Deprecated: use go run ./cmd/provider_dev_token from services/control-api instead.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func main() {
	fmt.Fprintln(os.Stderr, "token_gen is deprecated — use: go run ./cmd/provider_dev_token")
	_, self, _, _ := runtime.Caller(0)
	apiRoot := filepath.Join(filepath.Dir(self), "..", "..")
	cmd := exec.Command("go", "run", "./cmd/provider_dev_token")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = apiRoot
	_ = cmd.Run()
	if cmd.ProcessState != nil {
		os.Exit(cmd.ProcessState.ExitCode())
	}
	os.Exit(1)
}
