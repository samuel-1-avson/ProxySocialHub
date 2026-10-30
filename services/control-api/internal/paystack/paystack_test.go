package paystack

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidSignature(t *testing.T) {
	t.Setenv("PAYSTACK_SECRET_KEY", "sk_test_abc")
	body := []byte(`{"event":"charge.success","data":{"reference":"r1"}}`)
	mac := hmac.New(sha512.New, []byte("sk_test_abc"))
	mac.Write(body)
	good := hex.EncodeToString(mac.Sum(nil))

	if !ValidSignature(body, good) {
		t.Fatal("valid signature rejected")
	}
	if ValidSignature(append(body, ' '), good) {
		t.Fatal("signature over a different body accepted")
	}
	if ValidSignature(body, "") || ValidSignature(body, "zz") {
		t.Fatal("empty or malformed signature accepted")
	}
	t.Setenv("PAYSTACK_SECRET_KEY", "")
	if ValidSignature(body, good) {
		t.Fatal("signature accepted with no key configured")
	}
}

func TestVerifyAndInitialize(t *testing.T) {
	t.Setenv("PAYSTACK_SECRET_KEY", "sk_test_abc")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk_test_abc" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"status":false,"message":"Invalid key"}`))
			return
		}
		switch r.URL.Path {
		case "/transaction/initialize":
			var req InitializeRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req.Currency != "GHS" || req.Amount != 1234 {
				t.Errorf("unexpected initialize body: %+v", req)
			}
			_, _ = w.Write([]byte(`{"status":true,"message":"ok","data":{"authorization_url":"https://checkout/x","access_code":"ac_1","reference":"` + req.Reference + `"}}`))
		case "/transferrecipient":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["type"] != "mobile_money" || body["bank_code"] != "MTN" || body["currency"] != "GHS" {
				t.Errorf("unexpected recipient body: %v", body)
			}
			_, _ = w.Write([]byte(`{"status":true,"message":"ok","data":{"recipient_code":"RCP_1"}}`))
		case "/transfer":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["source"] != "balance" || body["recipient"] != "RCP_1" || body["amount"] != float64(1000) {
				t.Errorf("unexpected transfer body: %v", body)
			}
			_, _ = w.Write([]byte(`{"status":true,"message":"ok","data":{"transfer_code":"TRF_1","reference":"co-1","status":"pending","amount":1000,"currency":"GHS"}}`))
		case "/transfer/verify/co-1":
			_, _ = w.Write([]byte(`{"status":true,"message":"ok","data":{"transfer_code":"TRF_1","reference":"co-1","status":"success","amount":1000,"currency":"GHS"}}`))
		case "/transaction/verify/ref-1":
			_, _ = w.Write([]byte(`{"status":true,"message":"ok","data":{"id":42,"status":"success","reference":"ref-1","amount":1234,"currency":"GHS"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"status":false,"message":"Transaction reference not found"}`))
		}
	}))
	defer srv.Close()
	old := BaseURL
	BaseURL = srv.URL
	defer func() { BaseURL = old }()

	init, err := Initialize(context.Background(), InitializeRequest{Email: "a@b.c", Amount: 1234, Currency: "GHS", Reference: "ref-1"})
	if err != nil || init.AccessCode != "ac_1" {
		t.Fatalf("initialize: %v %+v", err, init)
	}
	tx, err := Verify(context.Background(), "ref-1")
	if err != nil || tx.Status != "success" || tx.Amount != 1234 || tx.Currency != "GHS" || tx.ID != 42 {
		t.Fatalf("verify: %v %+v", err, tx)
	}
	if _, err := Verify(context.Background(), "missing"); err == nil {
		t.Fatal("expected error for unknown reference")
	}

	code, err := CreateMoMoRecipient(context.Background(), "Ama", "0551234987", NetworkMTN)
	if err != nil || code != "RCP_1" {
		t.Fatalf("recipient: %v %q", err, code)
	}
	tr, err := Transfer(context.Background(), "co-1", 1000, "RCP_1", "earnings")
	if err != nil || tr.TransferCode != "TRF_1" || tr.Status != "pending" {
		t.Fatalf("transfer: %v %+v", err, tr)
	}
	vt, err := VerifyTransfer(context.Background(), "co-1")
	if err != nil || vt.Status != "success" {
		t.Fatalf("verify transfer: %v %+v", err, vt)
	}
	if ValidMoMoNetwork("XYZ") || !ValidMoMoNetwork(NetworkVOD) {
		t.Fatal("network validation wrong")
	}

	t.Setenv("PAYSTACK_SECRET_KEY", "")
	if _, err := Verify(context.Background(), "ref-1"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}
