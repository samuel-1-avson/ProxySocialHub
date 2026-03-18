package cmd

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/proxyhubb/control-api/cmd/provider-cli/internal/tunnel"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

type cliVersionInfo struct {
	Version    string `json:"version"`
	DownloadURL string `json:"download_url"`
	Checksum   string `json:"checksum"`
	Filename   string `json:"filename"`
}

// checkForUpdates silently checks if a newer CLI version is available and prints
// a one-line notice if so. Non-fatal — network errors are ignored.
func checkForUpdates() {
	apiBase := viper.GetString("api_url")
	if apiBase == "" {
		apiBase = "https://api.proxyhubb.com"
	}

	client := &http.Client{Timeout: 4 * time.Second}
	url := fmt.Sprintf("%s/v1/cli/downloads/latest?platform=%s&arch=%s",
		apiBase, runtime.GOOS, runtime.GOARCH)

	resp, err := client.Get(url)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var info cliVersionInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return
	}

	if info.Version != "" && info.Version != tunnel.Version {
		fmt.Fprintf(os.Stderr, "\n  Update available: %s → %s\n  Run: provider-cli update\n\n",
			tunnel.Version, info.Version)
	}
}

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the CLI to the latest version",
	Long:  `Download and install the latest version of the provider CLI, then exit.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		apiBase := viper.GetString("api_url")
		if apiBase == "" {
			apiBase = "https://api.proxyhubb.com"
		}

		fmt.Printf("Checking for updates (current: %s)...\n", tunnel.Version)

		client := &http.Client{Timeout: 10 * time.Second}
		url := fmt.Sprintf("%s/v1/cli/downloads/latest?platform=%s&arch=%s",
			apiBase, runtime.GOOS, runtime.GOARCH)

		resp, err := client.Get(url)
		if err != nil {
			return fmt.Errorf("failed to fetch version info: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("version check returned HTTP %d", resp.StatusCode)
		}

		var info cliVersionInfo
		if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
			return fmt.Errorf("failed to parse version info: %w", err)
		}

		if info.Version == tunnel.Version {
			fmt.Printf("Already up to date (%s).\n", tunnel.Version)
			return nil
		}

		fmt.Printf("Downloading %s...\n", info.Version)

		dlResp, err := client.Get(info.DownloadURL)
		if err != nil {
			return fmt.Errorf("download failed: %w", err)
		}
		defer dlResp.Body.Close()

		// Write to a temp file next to the current binary
		exePath, err := os.Executable()
		if err != nil {
			return fmt.Errorf("cannot determine executable path: %w", err)
		}

		tmpPath := exePath + ".new"
		f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if err != nil {
			return fmt.Errorf("cannot create temp file: %w", err)
		}

		if _, err := io.Copy(f, dlResp.Body); err != nil {
			f.Close()
			os.Remove(tmpPath)
			return fmt.Errorf("download interrupted: %w", err)
		}
		f.Close()

		// Verify SHA256 checksum if the server provided one.
		if info.Checksum != "" {
			fmt.Print("Verifying checksum... ")
			got, err := sha256File(tmpPath)
			if err != nil {
				os.Remove(tmpPath)
				return fmt.Errorf("checksum read failed: %w", err)
			}
			if got != info.Checksum {
				os.Remove(tmpPath)
				return fmt.Errorf("checksum mismatch (got %s, want %s) — download may be corrupted or tampered", got, info.Checksum)
			}
			fmt.Println("OK")
		}

		// Atomically replace the current binary.
		if err := os.Rename(tmpPath, exePath); err != nil {
			os.Remove(tmpPath)
			return fmt.Errorf("failed to replace binary (try with sudo?): %w", err)
		}

		fmt.Printf("Updated to %s. Please restart the CLI.\n", info.Version)
		return nil
	},
}

// sha256File returns the lowercase hex SHA256 digest of the file at path.
func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func init() {
	rootCmd.AddCommand(updateCmd)
}
