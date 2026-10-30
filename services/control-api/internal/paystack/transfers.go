package paystack

import (
	"context"
	"net/http"
	"net/url"
)

// MoMo network codes Paystack uses as bank_code for Ghana mobile money.
const (
	NetworkMTN = "MTN" // MTN Mobile Money
	NetworkVOD = "VOD" // Telecel Cash (formerly Vodafone Cash)
	NetworkATL = "ATL" // AirtelTigo Money
)

// ValidMoMoNetwork reports whether code is a supported Ghana MoMo network.
func ValidMoMoNetwork(code string) bool {
	switch code {
	case NetworkMTN, NetworkVOD, NetworkATL:
		return true
	}
	return false
}

// CreateMoMoRecipient registers a Ghana mobile money number for transfers
// (POST /transferrecipient) and returns its recipient_code.
func CreateMoMoRecipient(ctx context.Context, name, phone, network string) (string, error) {
	var out struct {
		RecipientCode string `json:"recipient_code"`
	}
	err := call(ctx, http.MethodPost, "/transferrecipient", map[string]any{
		"type":           "mobile_money",
		"name":           name,
		"account_number": phone,
		"bank_code":      network,
		"currency":       "GHS",
	}, &out)
	if err != nil {
		return "", err
	}
	return out.RecipientCode, nil
}

// TransferResult is the subset of a transfer we act on. Status is one of
// success, pending, otp, failed, reversed (Paystack also reports "received"/"queued").
type TransferResult struct {
	TransferCode string `json:"transfer_code"`
	Reference    string `json:"reference"`
	Status       string `json:"status"`
	Amount       int64  `json:"amount"`
	Currency     string `json:"currency"`
}

// Transfer pays amountMinor (pesewas) from the Paystack balance to a recipient
// (POST /transfer). Paystack rejects a reused reference, so a retry with the same
// reference cannot pay twice.
func Transfer(ctx context.Context, reference string, amountMinor int64, recipientCode, reason string) (*TransferResult, error) {
	var out TransferResult
	err := call(ctx, http.MethodPost, "/transfer", map[string]any{
		"source":    "balance",
		"amount":    amountMinor,
		"currency":  "GHS",
		"recipient": recipientCode,
		"reference": reference,
		"reason":    reason,
	}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// VerifyTransfer fetches a transfer by our reference (GET /transfer/verify/:reference).
func VerifyTransfer(ctx context.Context, reference string) (*TransferResult, error) {
	var out TransferResult
	if err := call(ctx, http.MethodGet, "/transfer/verify/"+url.PathEscape(reference), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
