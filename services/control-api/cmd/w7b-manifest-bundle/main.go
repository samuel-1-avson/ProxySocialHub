package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/gateways"
)

func usage() {
	fmt.Fprintf(os.Stderr, `w7b-manifest-bundle — verify/list a Wave 7.B operator manifest bundle (no control-api).

Usage:
  w7b-manifest-bundle verify <file-or-url>
  w7b-manifest-bundle list   <file-or-url>

A file path, http(s) URL, or raw CID (fetched via IPFS_GATEWAY) is accepted.
Exit 0 only when at least one operator verifies and none fail (verify).
`)
	os.Exit(2)
}

func main() {
	if len(os.Args) < 3 {
		usage()
	}
	cmd := strings.ToLower(os.Args[1])
	src := os.Args[2]
	raw, err := readSource(src)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read: %v\n", err)
		os.Exit(2)
	}
	bundle, err := gateways.ParseBundle(raw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse: %v\n", err)
		os.Exit(2)
	}
	entries := gateways.VerifyBundleEntries(bundle, false)
	switch cmd {
	case "list":
		for _, e := range entries {
			fmt.Printf("%s host_id=%s verified=%v %s\n", e.Operator.Slug, e.Operator.HostID, e.Verified, e.Reason)
		}
		fmt.Printf("count=%d discovery_sot=bundle\n", len(entries))
	case "verify":
		ok := 0
		bad := 0
		for _, e := range entries {
			if e.Verified {
				ok++
				fmt.Printf("ok %s\n", e.Operator.Slug)
			} else {
				bad++
				fmt.Printf("fail %s %s\n", e.Operator.Slug, e.Reason)
			}
		}
		fmt.Printf("verified=%d failed=%d discovery_sot=bundle\n", ok, bad)
		if ok == 0 || bad > 0 {
			os.Exit(1)
		}
		fmt.Println("W7B_BUNDLE_VERIFY_OK")
	default:
		usage()
	}
}

func readSource(src string) ([]byte, error) {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return httpGet(src)
	}
	if _, err := os.Stat(src); err == nil {
		return os.ReadFile(src)
	}
	// Bare CID → IPFS gateway.
	if looksLikeCID(src) {
		gw := strings.TrimSpace(os.Getenv("IPFS_GATEWAY"))
		if gw == "" {
			gw = "https://ipfs.io/ipfs/"
		}
		if !strings.HasSuffix(gw, "/") {
			gw += "/"
		}
		return httpGet(gw + src)
	}
	return os.ReadFile(src)
}

func looksLikeCID(s string) bool {
	s = strings.TrimSpace(s)
	return strings.HasPrefix(s, "Qm") || strings.HasPrefix(s, "bafy") || strings.HasPrefix(s, "bafk")
}

func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("GET %s: %s %s", url, resp.Status, body)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}
