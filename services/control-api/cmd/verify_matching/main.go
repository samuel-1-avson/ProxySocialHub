package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const BaseURL = "http://localhost:8081"

func main() {
	fmt.Println("=== Verifying AI Smart Matching API ===")

	// 1. Login
	token, err := login()
	if err != nil {
		fmt.Printf("❌ Login Failed: %v\n", err)
		return
	}
	fmt.Println("✅ 1. Login Successful")

	// 2. Get Use Cases
	err = getUseCases(token)
	if err != nil {
		fmt.Printf("❌ Get Use Cases Failed: %v\n", err)
		return
	}
	fmt.Println("✅ 2. Use Cases Endpoint Verified")

	// 3. Get Recommendation
	err = getRecommendation(token, "streaming")
	if err != nil {
		fmt.Printf("❌ Get Recommendation Failed: %v\n", err)
		return
	}
	fmt.Println("✅ 3. Recommendation Endpoint Verified")

	fmt.Println("\n=== Smart Matching Engine Verified ===")
}

func login() (string, error) {
	resp, err := http.Post(BaseURL+"/v1/auth/dev/login", "application/json", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}

	var res struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&res)
	return res.Token, nil
}

func getUseCases(token string) error {
	req, _ := http.NewRequest("GET", BaseURL+"/v1/matching/use-cases", nil)
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

	// Print response for debug
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("   Response: %s\n", string(body))
	return nil
}

func getRecommendation(token, useCase string) error {
	payload := map[string]interface{}{
		"use_case": useCase,
		"region":   "us", // Test region filter
		"count":    3,
	}
	data, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", BaseURL+"/v1/matching/recommend", bytes.NewBuffer(data))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("   Response: %s\n", string(body))
	return nil
}
