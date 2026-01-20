package main

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

const (
	TargetURL       = "http://localhost:8081/health"
	ConcurrentUsers = 100
	RequestsPerUser = 50
)

func main() {
	fmt.Printf("Starting Load Test on %s\n", TargetURL)
	fmt.Printf("Concurrent Users: %d\n", ConcurrentUsers)
	fmt.Printf("Requests Per User: %d\n", RequestsPerUser)
	fmt.Printf("Total Requests: %d\n", ConcurrentUsers*RequestsPerUser)

	var wg sync.WaitGroup
	start := time.Now()

	successCount := 0
	failCount := 0
	var mu sync.Mutex

	for i := 0; i < ConcurrentUsers; i++ {
		wg.Add(1)
		go func(userID int) {
			defer wg.Done()
			client := &http.Client{
				Timeout: 2 * time.Second,
			}

			for j := 0; j < RequestsPerUser; j++ {
				startReq := time.Now()
				resp, err := client.Get(TargetURL)
				latency := time.Since(startReq)

				mu.Lock()
				if err == nil && resp.StatusCode == 200 {
					successCount++
				} else {
					failCount++
					if failCount <= 5 {
						if err != nil {
							fmt.Printf("Error: %v\n", err)
						} else {
							fmt.Printf("Status: %d\n", resp.StatusCode)
						}
					}
				}
				mu.Unlock()

				if j == 0 && userID == 0 {
					fmt.Printf("Sample Latency: %v\n", latency)
				}
			}
		}(i)
	}

	wg.Wait()
	duration := time.Since(start)

	fmt.Println("\n--- Load Test Results ---")
	fmt.Printf("Total Duration: %v\n", duration)
	fmt.Printf("Total Requests: %d\n", successCount+failCount)
	fmt.Printf("Success: %d\n", successCount)
	fmt.Printf("Failed: %d\n", failCount)
	fmt.Printf("Requests/Sec: %.2f\n", float64(successCount+failCount)/duration.Seconds())
}
