package cmd

import (
	"fmt"
	"runtime"

	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/tunnel"
	"github.com/spf13/cobra"
)

// Build information (set by ldflags during build)
var (
	BuildTime   = "unknown"
	GitCommit   = "unknown"
	GitBranch   = "unknown"
	GoVersion   = runtime.Version()
	Platform    = fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Long:  `Display detailed version information about the provider CLI.`,
	Run: func(cmd *cobra.Command, args []string) {
		verbose, _ := cmd.Flags().GetBool("verbose")

		if verbose {
			fmt.Println("ProxyHub Provider CLI")
			fmt.Println("====================")
			fmt.Printf("Version:     %s\n", tunnel.Version)
			fmt.Printf("Build Time:  %s\n", BuildTime)
			fmt.Printf("Git Commit:  %s\n", GitCommit)
			fmt.Printf("Git Branch:  %s\n", GitBranch)
			fmt.Printf("Go Version:  %s\n", GoVersion)
			fmt.Printf("Platform:    %s\n", Platform)
			fmt.Println()
			fmt.Println("Protocol:    Yamux over TCP/TLS")
			fmt.Println("Features:    HTTP CONNECT, Bandwidth Reporting, Heartbeat")
		} else {
			shortCommit := GitCommit
		if len(shortCommit) > 7 {
			shortCommit = shortCommit[:7]
		}
		fmt.Printf("provider-cli version %s (%s)\n", tunnel.Version, shortCommit)
		}
	},
}

func init() {
	versionCmd.Flags().BoolP("verbose", "v", false, "Show detailed version information")
	rootCmd.AddCommand(versionCmd)
}
