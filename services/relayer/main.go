package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
	"time" // This import is necessary for time.NewTicker and time.Minute

	"github.com/proxyhubb/relayer/db"
	"github.com/proxyhubb/relayer/eth"
	"github.com/proxyhubb/relayer/workers"
)

func main() {
	log.Println("Starting ProxyHub Relayer Service...")

	// 1. Initialize Ethereum Client
	rpcUrl := os.Getenv("ETH_RPC_URL")
	if rpcUrl == "" {
		rpcUrl = "http://127.0.0.1:8545" // Default to local hardhat
	}

	privateKey := os.Getenv("RELAYER_PRIVATE_KEY")
	if privateKey == "" {
		// Test key (Hardhat Account #1)
		privateKey = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
	}

	contractAddress := os.Getenv("MARKETPLACE_CONTRACT_ADDRESS")
	if contractAddress == "" {
		log.Fatal("MARKETPLACE_CONTRACT_ADDRESS env var is required")
	}

	ethClient, err := eth.NewClient(rpcUrl, privateKey, contractAddress)
	if err != nil {
		log.Fatalf("Failed to initialize ETH client: %v", err)
	}
	log.Printf("Connected to Ethereum node at %s", rpcUrl)

	/*
		// 1.5 Fund Treasury (Test Mode)
		// Deposit 1 ETH on startup
		if _, err := ethClient.Deposit(new(big.Int).SetInt64(1000000000000000000)); err != nil {
			log.Printf("Failed to fund treasury: %v", err)
		} else {
			log.Println("Funded Treasury with 1 ETH")
		}
	*/

	// 2. Initialize Database
	db.Connect()

	// 3. Initialize Payout Worker
	payoutWorker := workers.NewPayoutWorker(ethClient)

	// 4. Start Background Loop
	ticker := time.NewTicker(60 * time.Minute) // Check every hour
	done := make(chan bool)

	go func() {
		// Run once immediately on startup
		log.Println("Running initial payout check...")
		if err := payoutWorker.ProcessPayouts(); err != nil {
			log.Printf("Error processing payouts: %v", err)
		}

		for {
			select {
			case <-done:
				return
			case t := <-ticker.C:
				log.Printf("Starting payout check at %v", t)
				if err := payoutWorker.ProcessPayouts(); err != nil {
					log.Printf("Error processing payouts: %v", err)
				}
			}
		}
	}()

	// Wait for interrupt
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	<-sigs

	log.Println("Shutting down Relayer...")
	done <- true
	log.Println("Exited.")
}
