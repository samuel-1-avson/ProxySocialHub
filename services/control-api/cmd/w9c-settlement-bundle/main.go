package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/settlement"
)

func usage() {
	fmt.Fprintf(os.Stderr, `w9c-settlement-bundle — verify/emit a Wave 9.C portable settlement receipt (no Postgres).

Does not send SOL. Not trustless metering. Not programs/session.

Usage:
  w9c-settlement-bundle emit
  w9c-settlement-bundle verify <file-or-url>
  w9c-settlement-bundle show   <file-or-url>
`)
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd := strings.ToLower(os.Args[1])
	if cmd == "emit" {
		r, err := settlement.EmitSampleReceipt(settlement.SigningKey(), "")
		if err != nil {
			fmt.Fprintf(os.Stderr, "emit: %v\n", err)
			os.Exit(2)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		_ = enc.Encode(r)
		return
	}
	if len(os.Args) < 3 {
		usage()
	}
	raw, err := readSource(os.Args[2])
	if err != nil {
		fmt.Fprintf(os.Stderr, "read: %v\n", err)
		os.Exit(2)
	}
	r, err := settlement.ParseReceipt(raw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse: %v\n", err)
		os.Exit(2)
	}
	ok := settlement.VerifyReceipt(*r)
	sot := settlement.ReceiptSoT(r.EscrowTx)
	switch cmd {
	case "show":
		fmt.Printf("window=%s session=%s bytes=%d status=%s escrow_tx=%s sot=%s verified=%v\n",
			r.WindowKey, r.SessionID, r.TotalBytes, r.Status, r.EscrowTx, sot, ok)
	case "verify":
		fmt.Printf("verified=%v settlement_sot=%s would_broadcast=%v\n", ok, sot, settlement.WouldBroadcast())
		if !ok {
			os.Exit(1)
		}
		fmt.Println("W9C_SETTLEMENT_RECEIPT_OK")
	default:
		usage()
	}
}

func readSource(src string) ([]byte, error) {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Get(src)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			return nil, fmt.Errorf("GET %s: %s %s", src, resp.Status, body)
		}
		return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	}
	return os.ReadFile(src)
}
