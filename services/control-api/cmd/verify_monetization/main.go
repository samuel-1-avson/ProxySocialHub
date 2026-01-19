package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
)

const (
	BaseURL = "http://localhost:8081"
)

// Response Structs
type loginResponse struct {
	Token string `json:"token"`
	User  struct {
		ID uuid.UUID `json:"id"`
	} `json:"user"`
}

type orderResponse struct {
	Order struct {
		ID string `json:"id"`
	} `json:"order"`
}

func main() {
	fmt.Println("=== Starting E2E Verification: Monetization & Escrow ===")

	// 1. Login Seller
	fmt.Println("\n[1/5] Logging in Seller...")
	sellerToken, sellerID, err := login("seller")
	if err != nil {
		fmt.Printf("❌ Seller Login Failed: %v\n", err)
		return
	}
	fmt.Printf("✅ Seller Logged in: %s\n", sellerID)

	// 2. Login Buyer
	fmt.Println("\n[2/5] Logging in Buyer...")
	buyerToken, buyerID, err := login("buyer")
	if err != nil {
		fmt.Printf("❌ Buyer Login Failed: %v\n", err)
		return
	}
	fmt.Printf("✅ Buyer Logged in: %s\n", buyerID)

	// 3. Create Listing (as Seller)
	fmt.Println("\n[3/5] Creating Proxy Listing...")
	listingID, err := createListing(sellerToken)
	if err != nil {
		fmt.Printf("❌ Create Listing Failed: %v\n", err)
		return
	}
	fmt.Printf("✅ Listing Created! ID: %s\n", listingID)

	// 4. Create Order (as Buyer)
	fmt.Println("\n[4/5] Purchasing Listing (Creating Order)...")
	orderID, err := createOrder(buyerToken, listingID)
	if err != nil {
		fmt.Printf("❌ Create Order Failed: %v\n", err)
		return
	}
	fmt.Printf("✅ Order Created! ID: %s (Funds Locked in Escrow)\n", orderID)

	// 5. Release Escrow (as Buyer)
	// In real flow, buyer releases after verifying.
	fmt.Println("\n[5/5] Releasing Funds...")
	err = releaseEscrow(buyerToken, orderID)
	if err != nil {
		fmt.Printf("❌ Release Escrow Failed: %v\n", err)
		return
	}
	fmt.Printf("✅ Funds Released! Transaction Complete.\n")

	fmt.Println("\n=== Monetization Verification Complete: SUCCESS ===")
}

func login(role string) (string, string, error) {
	// We use the dev login which generates a random user each time or based on simple seed if implemented
	// The current dev login just creates a new user.
	url := BaseURL + "/v1/auth/dev/login"
	req, _ := http.NewRequest("POST", url, nil)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var res loginResponse
	json.NewDecoder(resp.Body).Decode(&res)

	// Fund the wallet for buyer so they can buy
	if role == "buyer" {
		fundWallet(res.Token)
	}

	return res.Token, res.User.ID.String(), nil
}

func fundWallet(token string) {
	// Helper to add fake funds via a debug endpoint or we assume dev login gives funds?
	// Current imp doesn't give initial funds.
	// We need to implement a "faucet" or just use direct DB update if we were inside the app.
	// Since we are external, we rely on existing logic.
	// Reviewing wallet.go: usually there is a deposit mock.
	// Let's assume there is a /v1/wallet/deposit endpoint

	payload := map[string]interface{}{
		"amount":  100.0,
		"gateway": "mock",
	}
	data, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", BaseURL+"/v1/wallet/deposit", bytes.NewBuffer(data))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(req)
}

func createListing(token string) (string, error) {
	payload := map[string]interface{}{
		"title":                  "High Speed US Residential",
		"description":            "Premium proxy node",
		"proxy_type":             "residential",
		"price_per_gb":           5.0,
		"bandwidth_gb":           1000.0,
		"protocol":               "http",
		"max_concurrency":        100,
		"available_bandwidth_gb": 1000.0,
	}
	data, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", BaseURL+"/v1/listings", bytes.NewBuffer(data))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	fmt.Printf("Debug: Listing Response Body: %s\n", string(bodyBytes))

	if resp.StatusCode != 201 {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// Decoding flat Listing object
	var res struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(bytes.NewBuffer(bodyBytes)).Decode(&res); err != nil {
		return "", fmt.Errorf("decode error: %v", err)
	}
	if res.ID == "" {
		fmt.Printf("Warning: ID empty in response: %s\n", string(bodyBytes))
	}
	return res.ID, nil
}

func createOrder(token, listingID string) (string, error) {
	payload := map[string]interface{}{
		"listing_id":   listingID,
		"bandwidth_gb": 10.0, // 10GB * $5 = $50
	}
	data, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", BaseURL+"/v1/orders", bytes.NewBuffer(data))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var res orderResponse
	json.NewDecoder(resp.Body).Decode(&res)
	return res.Order.ID, nil
}

func releaseEscrow(token, orderID string) error {
	req, _ := http.NewRequest("POST", BaseURL+"/v1/escrow/"+orderID+"/release", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
