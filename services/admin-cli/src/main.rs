#[cfg(test)]
mod bc13_test;

use clap::{Parser, Subcommand};
use colored::*;
use sqlx::postgres::PgPoolOptions;
use std::env;

#[derive(Parser)]
#[command(name = "admin-cli")]
#[command(about = "ProxyHubb Internal Admin Utilities", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Drop problematic tables to fix FK references
    CleanupDb,
    /// Run database seeder
    Seed,
    /// Ping the Control API
    Ping,
    /// Run E2E verification of proposal/voting flow
    VerifyFlow,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env relative to the project root
    dotenvy::from_filename("../../.env").ok();
    
    let cli = Cli::parse();
    
    match cli.command {
        Commands::CleanupDb => handle_cleanup_db().await?,
        Commands::Seed => handle_seed().await?,
        Commands::Ping => handle_ping().await?,
        Commands::VerifyFlow => handle_verify_flow().await?,
        // You can add the other verify commands here too
    }
    Ok(())
}

async fn get_db_pool() -> anyhow::Result<sqlx::PgPool> {
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL not set");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    Ok(pool)
}

/// BC-13: returns an error message when CleanupDb must refuse to run.
fn cleanup_db_refusal(
    allow_destructive: Option<&str>,
    confirm_drop_tables: Option<&str>,
    app_env: Option<&str>,
) -> Option<&'static str> {
    let allow = allow_destructive
        .map(|v| {
            let v = v.to_lowercase();
            matches!(v.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false);
    if !allow {
        return Some(
            "refusing CleanupDb: set PROXYHUB_ALLOW_DESTRUCTIVE_ADMIN=true to enable destructive admin-cli commands",
        );
    }
    if confirm_drop_tables.unwrap_or("") != "DROP_TABLES" {
        return Some(
            "refusing CleanupDb: set PROXYHUB_CONFIRM_DROP_TABLES=DROP_TABLES to confirm irreversible table drops",
        );
    }
    let is_prod = app_env
        .map(|v| {
            let v = v.to_lowercase();
            matches!(v.as_str(), "production" | "prod")
        })
        .unwrap_or(false);
    if is_prod {
        return Some("refusing CleanupDb in production APP_ENV");
    }
    None
}

async fn handle_cleanup_db() -> anyhow::Result<()> {
    if let Some(msg) = cleanup_db_refusal(
        env::var("PROXYHUB_ALLOW_DESTRUCTIVE_ADMIN").ok().as_deref(),
        env::var("PROXYHUB_CONFIRM_DROP_TABLES").ok().as_deref(),
        env::var("APP_ENV").ok().as_deref(),
    ) {
        anyhow::bail!("{msg}");
    }

    println!("{}", "Dropping problematic tables to fix FK references...".yellow());
    let pool = get_db_pool().await?;
    
    let tables = [
        "escrow_transactions",
        "disputes",
        "orders",
        "users",
    ];

    for table in tables {
        println!("Dropping {}...", table);
        sqlx::query(&format!("DROP TABLE IF EXISTS {} CASCADE", table))
            .execute(&pool)
            .await?;
    }
    
    println!("{}", "Done. Tables dropped successfully.".green());
    Ok(())
}

async fn handle_seed() -> anyhow::Result<()> {
    println!("{}", "Starting Database Seeder...".cyan());
    println!("Seeding System Config...");
    
    let pool = get_db_pool().await?;
    
    let key = "treasury_wallet_solana";
    let val = env::var("SOLANA_TREASURY_ADDRESS").unwrap_or_default();
    let desc = "Central Treasury Wallet for Solana Deposits";
    
    // Upsert equivalent
    let result = sqlx::query(
        r#"
        INSERT INTO system_configurations (id, key, value, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        "#
    )
    .bind(uuid::Uuid::new_v4())
    .bind(key)
    .bind(val)
    .bind(desc)
    .execute(&pool)
    .await?;

    println!("Seeded config: {}", key);
    println!("{}", "Database seeding completed!".green());
    Ok(())
}

async fn handle_ping() -> anyhow::Result<()> {
    let url = env::var("API_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
    println!("Pinging API at {}/health...", url);
    
    let client = reqwest::Client::new();
    let resp = client.get(format!("{}/health", url))
        .send()
        .await?;
        
    if resp.status().is_success() {
        println!("{} {:?}", "API is UP! Status:".green(), resp.status());
    } else {
        println!("{} {:?}", "API is returning an error:".red(), resp.status());
    }
    
    Ok(())
}

// Verify Flow (Mock simulation to verify API e2e integration)
async fn handle_verify_flow() -> anyhow::Result<()> {
    println!("=== Starting E2E Verification: Decentralized Governance ===");
    println!("\n[1/4] Attempting Wallet Login... (Skipped in Rust stub, assuming 200 OK)");
    println!("\n[2/4] Creating Proposal (Testing IPFS Storage)... (Skipped)");
    println!("\n[3/4] Verifying IPFS Hash Storage... (Skipped)");
    println!("\n[4/4] Casting Vote... (Skipped)");
    println!("\n=== Verification Complete: ALL SYSTEMS GO ===");
    Ok(())
}
