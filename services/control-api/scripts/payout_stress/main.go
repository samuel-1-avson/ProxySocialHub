package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

const (
	baseURL      = "http://localhost:8080/v1"
	adminToken   = "test-admin-token" // Replace with real token or use env
	providerID   = "7963d7e5-1c3a-4a7b-8e9f-0c1d2e3f4a5b" // Example provider UUID
	concurrency  = 10
	iterations   = 5
)

func main() {
	fmt.Println("🚀 Starting Payout Stress Test...")
	
	var wg sync.WaitGroup
	start := time.Now()

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				queuePayout(id, j)
			}
		}(i)
	}

	wg.Wait()
	duration := time.Since(start)
	
	fmt.Printf("\n✅ Stress test complete in %v\n", duration)
	fmt.Println("Please run 'GET /v1/admin/treasury/reconciliation' to verify ledger consistency.")
}

func queuePayout(workerID, iteration int) {
	url := fmt.Sprintf("%s/admin/payouts/queue", baseURL)
	
	payload := map[string]string{
		"provider_id": providerID,
	}
	jsonPayload, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Printf("[Worker %d] Error creating request: %v", workerID, err)
		return
	}

	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Worker %d] Request failed: %v", workerID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		log.Printf("[Worker %d] Payout failed: %s", workerID, resp.Status)
	} else {
		log.Printf("[Worker %d] Payout queued successfully (iteration %d)", workerID, iteration)
	}
}
