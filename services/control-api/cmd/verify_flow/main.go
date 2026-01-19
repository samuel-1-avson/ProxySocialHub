package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/google/uuid"
)

const (
	BaseURL = "http://localhost:8081"
)

// loginResponse reflects the mock auth output
type loginResponse struct {
	Token string `json:"token"`
	User  struct {
		ID       uuid.UUID `json:"id"`
		Role     string    `json:"role"`
		Username string    `json:"username"`
	} `json:"user"`
}

func main() {
	fmt.Println("=== Starting E2E Verification: Decentralized Governance ===")

	// 1. Login (Mocked Wallet Auth)
	// We rely on the /auth/wallet/login endpoint.
	// For this test, we assume we can bypass signature verification OR use a dev test account if configured.
	// Actually, since we don't have a signed message generator here easily, we might need a "Backdoor" or rely on the fact that
	// verifySignature mocks "0x_valid_signature" in the bridge?
	// Let's try to hit the "Simulated" flow if possible.
	// If we can't login easily, we will simulate the "Action" steps assuming we have a token.
	// OPTION: We'll construct the request expecting the Bridge Mock to accept "0x_mock..." signature.

	fmt.Println("\n[1/4] Attempting Wallet Login...")
	token, userID, err := login()
	if err != nil {
		fmt.Printf("❌ Login Failed: %v\n", err)
		// For verification purposes, if login fails (e.g. server down), we stop.
		// However, if we are just testing logic, maybe we can run internal unit tests.
		// But let's assume server is running Mock Bridge.
		return
	}
	fmt.Printf("✅ Logged in as %s (Token: %s...)\n", userID, token[:10])

	// 2. Create Proposal
	fmt.Println("\n[2/4] Creating Proposal (Testing IPFS Storage)...")
	proposalID, err := createProposal(token)
	if err != nil {
		fmt.Printf("❌ Create Proposal Failed: %v\n", err)
		return
	}
	fmt.Printf("✅ Proposal Created! ID: %s\n", proposalID)

	// 3. Verify IPFS Hash
	fmt.Println("\n[3/4] Verifying IPFS Hash Storage...")
	err = verifyProposalStorage(token, proposalID)
	if err != nil {
		fmt.Printf("❌ IPFS Verification Failed: %v\n", err)
		return
	}
	fmt.Println("✅ IPFS Hash found and verified.")

	// 4. Vote
	fmt.Println("\n[4/4] Casting Vote...")
	err = castVote(token, proposalID)
	if err != nil {
		fmt.Printf("❌ Voting Failed: %v\n", err)
		return
	}
	fmt.Println("✅ Vote Cast Successfully!")

	fmt.Println("\n=== Verification Complete: ALL SYSTEMS GO ===")
}

func login() (string, string, error) {
	// Use the Dev Backdoor for E2E testing
	url := BaseURL + "/v1/auth/dev/login"
	fmt.Printf("Login URL: %s\n", url)
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
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
	return res.Token, res.User.ID.String(), nil
}

func createProposal(token string) (string, error) {
	payload := map[string]interface{}{
		"title":         "Integration Test Proposal",
		"description":   "This is a test verifying IPFS storage logic.",
		"duration_days": 3,
	}
	data, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", BaseURL+"/v1/governance/proposals", bytes.NewBuffer(data))
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

	var res struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&res)
	return res.ID, nil
}

func verifyProposalStorage(token, id string) error {
	req, _ := http.NewRequest("GET", BaseURL+"/v1/governance/proposals/"+id, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var res struct {
		IPFSHash string `json:"ipfs_hash"`
	}
	json.NewDecoder(resp.Body).Decode(&res)

	if res.IPFSHash == "" {
		return fmt.Errorf("IPFS Hash is missing")
	}
	if len(res.IPFSHash) < 40 {
		return fmt.Errorf("IPFS Hash looks invalid: %s", res.IPFSHash)
	}
	return nil
}

func castVote(token, id string) error {
	payload := map[string]string{
		"choice": "yes",
	}
	data, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", BaseURL+"/v1/governance/proposals/"+id+"/vote", bytes.NewBuffer(data))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
