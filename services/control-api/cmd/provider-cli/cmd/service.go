package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

// serviceCmd manages the provider as a system service
var serviceCmd = &cobra.Command{
	Use:   "service",
	Short: "Manage the provider as a system service",
	Long: `Install and manage the ProxyHub provider as a system service.

This allows the provider to:
- Start automatically on boot
- Restart automatically on failure
- Run in the background

Supported systems:
- Linux with systemd
- macOS with launchd (partial)
- Windows with Windows Service (planned)`,
}

// installSystemdService installs the provider as a systemd service.
// It is called by both serviceInstallCmd and the setup wizard.
func installSystemdService() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("service installation currently only supported on Linux with systemd")
	}

	if os.Getuid() != 0 {
		return fmt.Errorf("service installation requires root privileges. Run with sudo")
	}

	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}

	// Determine the user that will own the service process.
	// When invoked via sudo, SUDO_USER holds the original caller; fall back to root.
	user := os.Getenv("SUDO_USER")
	if user == "" {
		user = "root"
	}

	// Resolve the correct HOME for the service user.
	// root's home is /root, not /home/root.
	homeDir := "/home/" + user
	if user == "root" {
		homeDir = "/root"
	}

	serviceContent := fmt.Sprintf(`[Unit]
Description=ProxyHub Provider Node
After=network.target

[Service]
Type=simple
User=%s
ExecStart=%s node start
Restart=always
RestartSec=10
Environment="HOME=%s"

[Install]
WantedBy=multi-user.target
`, user, execPath, homeDir)

	servicePath := "/etc/systemd/system/proxyhub-provider.service"
	if err := os.WriteFile(servicePath, []byte(serviceContent), 0644); err != nil {
		return fmt.Errorf("failed to write service file: %w", err)
	}

	if err := exec.Command("systemctl", "daemon-reload").Run(); err != nil {
		return fmt.Errorf("failed to reload systemd: %w", err)
	}

	if err := exec.Command("systemctl", "enable", "proxyhub-provider").Run(); err != nil {
		return fmt.Errorf("failed to enable service: %w", err)
	}

	return nil
}

var serviceInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install as a system service",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch runtime.GOOS {
		case "linux":
			if err := installSystemdService(); err != nil {
				return err
			}
			fmt.Println("✓ Service installed successfully")
			fmt.Println()
			fmt.Println("Commands:")
			fmt.Println("  sudo systemctl start proxyhub-provider    # Start")
			fmt.Println("  sudo systemctl stop proxyhub-provider     # Stop")
			fmt.Println("  sudo systemctl status proxyhub-provider   # Status")
			fmt.Println("  sudo journalctl -u proxyhub-provider -f   # Logs")
		case "windows":
			if err := installWindowsService(); err != nil {
				return err
			}
			fmt.Println("✓ Service installed successfully")
			fmt.Println()
			fmt.Println("Commands:")
			fmt.Println("  provider-cli service start    # Start")
			fmt.Println("  provider-cli service stop     # Stop")
			fmt.Println("  provider-cli service status   # Status")
			fmt.Println("  View logs in Windows Event Viewer → Application → ProxyHubProvider")
		default:
			return fmt.Errorf("service installation not supported on %s", runtime.GOOS)
		}
		return nil
	},
}

var serviceUninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Uninstall the system service",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch runtime.GOOS {
		case "linux":
			if os.Getuid() != 0 {
				return fmt.Errorf("requires root privileges. Run with sudo")
			}
			exec.Command("systemctl", "stop", "proxyhub-provider").Run()
			exec.Command("systemctl", "disable", "proxyhub-provider").Run()
			servicePath := "/etc/systemd/system/proxyhub-provider.service"
			if err := os.Remove(servicePath); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("failed to remove service file: %w", err)
			}
			exec.Command("systemctl", "daemon-reload").Run()
		case "windows":
			if err := uninstallWindowsService(); err != nil {
				return err
			}
		default:
			return fmt.Errorf("service uninstallation not supported on %s", runtime.GOOS)
		}
		fmt.Println("✓ Service uninstalled successfully")
		return nil
	},
}

var serviceStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the system service",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch runtime.GOOS {
		case "linux":
			if os.Getuid() != 0 {
				return fmt.Errorf("requires root privileges. Run with sudo")
			}
			if err := exec.Command("systemctl", "start", "proxyhub-provider").Run(); err != nil {
				return fmt.Errorf("failed to start service: %w", err)
			}
		case "windows":
			if err := startWindowsService(); err != nil {
				return err
			}
		default:
			return fmt.Errorf("service commands not supported on %s", runtime.GOOS)
		}
		fmt.Println("✓ Service started")
		return nil
	},
}

var serviceStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the system service",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch runtime.GOOS {
		case "linux":
			if os.Getuid() != 0 {
				return fmt.Errorf("requires root privileges. Run with sudo")
			}
			if err := exec.Command("systemctl", "stop", "proxyhub-provider").Run(); err != nil {
				return fmt.Errorf("failed to stop service: %w", err)
			}
		case "windows":
			if err := stopWindowsService(); err != nil {
				return err
			}
		default:
			return fmt.Errorf("service commands not supported on %s", runtime.GOOS)
		}
		fmt.Println("✓ Service stopped")
		return nil
	},
}

var serviceStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Check service status",
	RunE: func(cmd *cobra.Command, args []string) error {
		switch runtime.GOOS {
		case "linux":
			output, err := exec.Command("systemctl", "status", "proxyhub-provider").CombinedOutput()
			if err != nil {
				if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 3 {
					fmt.Println("Service is not running")
					fmt.Println(string(output))
					return nil
				}
				return fmt.Errorf("failed to get status: %w\n%s", err, string(output))
			}
			fmt.Println(string(output))
		case "windows":
			fmt.Printf("Service status: %s\n", windowsServiceStatus())
		default:
			return fmt.Errorf("service commands not supported on %s", runtime.GOOS)
		}
		return nil
	},
}

var serviceLogsCmd = &cobra.Command{
	Use:   "logs",
	Short: "View service logs",
	RunE: func(cmd *cobra.Command, args []string) error {
		follow, _ := cmd.Flags().GetBool("follow")
		lines, _ := cmd.Flags().GetInt("lines")

		switch runtime.GOOS {
		case "linux":
			jArgs := []string{"-u", "proxyhub-provider", "-n", strconv.Itoa(lines)}
			if follow {
				jArgs = append(jArgs, "-f")
			}
			cmdExec := exec.Command("journalctl", jArgs...)
			cmdExec.Stdout = os.Stdout
			cmdExec.Stderr = os.Stderr
			return cmdExec.Run()
		case "windows":
			psScript := fmt.Sprintf(
				`Get-EventLog -LogName Application -Source ProxyHubProvider -Newest %d | Format-List`,
				lines,
			)
			cmdExec := exec.Command("powershell", "-Command", psScript)
			cmdExec.Stdout = os.Stdout
			cmdExec.Stderr = os.Stderr
			if err := cmdExec.Run(); err != nil {
				fmt.Println("Could not read event log. View logs in:")
				fmt.Println("  Windows Event Viewer → Windows Logs → Application → ProxyHubProvider")
			}
			return nil
		default:
			return fmt.Errorf("service logs not supported on %s", runtime.GOOS)
		}
	},
}

// isServiceRunning checks if the provider service is running on the current OS.
func isServiceRunning() bool {
	switch runtime.GOOS {
	case "linux":
		output, err := exec.Command("systemctl", "is-active", "proxyhub-provider").Output()
		if err != nil {
			return false
		}
		return strings.TrimSpace(string(output)) == "active"
	case "windows":
		return windowsServiceStatus() == "running"
	default:
		return false
	}
}

// ============================================================
// Windows service helpers (sc.exe — no extra imports needed)
// ============================================================

const windowsServiceName = "ProxyHubProvider"
const windowsServiceDisplay = "ProxyHub Provider Node"

func installWindowsService() error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}
	out, err := exec.Command("sc", "create", windowsServiceName,
		"binPath=", execPath+" node start",
		"DisplayName=", windowsServiceDisplay,
		"start=", "auto",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to create service: %s", strings.TrimSpace(string(out)))
	}
	exec.Command("sc", "description", windowsServiceName, "ProxyHub bandwidth sharing provider node").Run()
	exec.Command("sc", "failure", windowsServiceName, "reset=", "86400", "actions=", "restart/5000/restart/5000/restart/30000").Run()
	return nil
}

func uninstallWindowsService() error {
	exec.Command("sc", "stop", windowsServiceName).Run()
	out, err := exec.Command("sc", "delete", windowsServiceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to delete service: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func startWindowsService() error {
	out, err := exec.Command("sc", "start", windowsServiceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to start service: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func stopWindowsService() error {
	out, err := exec.Command("sc", "stop", windowsServiceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to stop service: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func windowsServiceStatus() string {
	out, err := exec.Command("sc", "query", windowsServiceName).CombinedOutput()
	if err != nil {
		return "not installed"
	}
	output := string(out)
	switch {
	case strings.Contains(output, "RUNNING"):
		return "running"
	case strings.Contains(output, "STOPPED"):
		return "stopped"
	case strings.Contains(output, "START_PENDING"):
		return "starting"
	case strings.Contains(output, "STOP_PENDING"):
		return "stopping"
	default:
		return strings.TrimSpace(output)
	}
}

func init() {
	rootCmd.AddCommand(serviceCmd)
	serviceCmd.AddCommand(serviceInstallCmd)
	serviceCmd.AddCommand(serviceUninstallCmd)
	serviceCmd.AddCommand(serviceStartCmd)
	serviceCmd.AddCommand(serviceStopCmd)
	serviceCmd.AddCommand(serviceStatusCmd)
	serviceCmd.AddCommand(serviceLogsCmd)

	serviceLogsCmd.Flags().BoolP("follow", "f", false, "Follow log output")
	serviceLogsCmd.Flags().IntP("lines", "n", 50, "Number of lines to show")
}
