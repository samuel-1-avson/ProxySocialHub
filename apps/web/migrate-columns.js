// Database migration script to increase column sizes for Solana signatures
const { Client } = require('pg');

async function migrate() {
    const client = new Client({
        connectionString: 'postgres://postgres.jkrypzxbnwdcdvhtjxgx:ProxyHubbUser2026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require'
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // Alter pending_transactions columns
        console.log('Altering pending_transactions.reference...');
        await client.query('ALTER TABLE pending_transactions ALTER COLUMN reference TYPE varchar(128)');

        console.log('Altering pending_transactions.external_ref...');
        await client.query('ALTER TABLE pending_transactions ALTER COLUMN external_ref TYPE varchar(128)');

        // Alter wallet_ledger_entries column
        console.log('Altering wallet_ledger_entries.reference_id...');
        await client.query('ALTER TABLE wallet_ledger_entries ALTER COLUMN reference_id TYPE varchar(128)');

        console.log('✅ Migration completed successfully!');
    } catch (err) {
        console.error('Migration error:', err.message);
    } finally {
        await client.end();
    }
}

migrate();
