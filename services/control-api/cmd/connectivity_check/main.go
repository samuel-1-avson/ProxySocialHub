package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

func main() {
	password := os.Getenv("DB_PASSWORD")
	projectRef := os.Getenv("PROJECT_REF")
	region := "aws-1-eu-west-1"

	if password == "" || projectRef == "" {
		fmt.Println("❌ Error: DB_PASSWORD and PROJECT_REF env vars must be set")
		return
	}

	dsns := []struct {
		Name string
		DSN  string
	}{
		{
			Name: "Pooler (Port 6543 - Transaction)",
			DSN:  fmt.Sprintf("postgres://postgres.%s:%s@%s.pooler.supabase.com:6543/postgres?sslmode=require", projectRef, password, region),
		},
		{
			Name: "Pooler (Port 5432 - Session)",
			DSN:  fmt.Sprintf("postgres://postgres.%s:%s@%s.pooler.supabase.com:5432/postgres?sslmode=require", projectRef, password, region),
		},
		{
			Name: "Direct (IPv6)",
			DSN:  fmt.Sprintf("postgres://postgres:%s@db.%s.supabase.co:5432/postgres?sslmode=require", password, projectRef),
		},
		{
			Name: "Pooler (Alternative Region aws-0)",
			DSN:  fmt.Sprintf("postgres://postgres.%s:%s@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require", projectRef, password),
		},
		{
			Name: "Pooler (Alternative User Format)",
			DSN:  fmt.Sprintf("postgres://postgres:%s@%s.pooler.supabase.com:6543/postgres?sslmode=require", password, region),
		},
	}

	fmt.Println("Starting Connectivity Diagnosis...")
	fmt.Printf("Project Ref: %s\n", projectRef)
	fmt.Printf("Password Used: %s\n", password)
	fmt.Println("-------------------------------------------")

	for _, config := range dsns {
		fmt.Printf("Testing: %s\n", config.Name)
		// Mask password in output
		safeDSN := strings.Replace(config.DSN, password, "*****", -1)
		fmt.Printf("URL: %s\n", safeDSN)

		db, err := sql.Open("postgres", config.DSN)
		if err != nil {
			fmt.Printf("❌ Failed to parse DSN: %v\n\n", err)
			continue
		}

		// Set short timeout
		done := make(chan error, 1)
		go func() {
			done <- db.Ping()
		}()

		select {
		case err := <-done:
			if err != nil {
				fmt.Printf("❌ Connection Failed: %v\n", err)
			} else {
				fmt.Printf("✅ SUCCESS! Connected successfully.\n")
				fmt.Printf("RECOMMENDED CONNECTION STRING: %s\n", config.DSN)
				return // Found a working one!
			}
		case <-time.After(5 * time.Second):
			fmt.Printf("❌ Connection Timed Out\n")
		}
		db.Close()
		fmt.Println("-------------------------------------------")
	}

	fmt.Println("Diagnostics Complete. If all failed, the password or project status is definitely the issue.")
}
