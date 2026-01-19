#!/bin/bash

# Base URL for Control API
API_URL="http://localhost:8081/v1"

echo "1. Checking Network Status..."
curl -s "$API_URL/bittensor/status" | jq .

echo -e "\n\n2. Creating Development Wallet..."
curl -s -X POST "$API_URL/bittensor/wallet/create" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev_wallet", "hotkey": "default"}' | jq .

echo -e "\n\n3. Getting Wallet Info..."
curl -s "$API_URL/bittensor/wallet?name=dev_wallet&hotkey=default" | jq .

echo -e "\n\nVerification Complete."
