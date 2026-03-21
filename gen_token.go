package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

func main() {
	secret := "e77cb64cc8a7c6133e44b437a60a600e7f6f9672d40472cce1be8dec0195b0fc"
	rawToken := "test-token-rust-provider"
	
	key := []byte(secret)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(rawToken))
	hash := hex.EncodeToString(mac.Sum(nil))
	
	fmt.Printf("Raw: %s\n", rawToken)
	fmt.Printf("Hash: %s\n", hash)
}
