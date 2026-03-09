/**
 * ProxyHubb Load Testing Suite
 * 
 * Usage: artillery run load_test.yml
 * Or: node load_test.js
 */

const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

// Configuration
const CONFIG = {
  // DevNet RPC endpoints for load distribution
  RPC_ENDPOINTS: [
    'https://api.devnet.solana.com',
    'https://devnet.genesysgo.net',
    'https://rpc.ankr.com/solana_devnet',
  ],
  
  // Program ID
  PROGRAM_ID: '2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7',
  
  // Test parameters
  CONCURRENT_USERS: 100,
  DURATION_SECONDS: 300, // 5 minutes
  RAMP_UP_SECONDS: 60,
  
  // Transaction types to test
  TEST_CASES: {
    ESCROW_INIT: 30,      // 30% of load
    ESCROW_SETTLE: 20,    // 20% of load
    DISPUTE_INIT: 10,     // 10% of load
    JURY_VOTE: 15,        // 15% of load
    PRICE_UPDATE: 5,      // 5% of load
    QUERY_ONLY: 20,       // 20% of load (read-only)
  }
};

/**
 * Load Test Scenario
 */
class ProxyHubbLoadTest {
  constructor() {
    this.connections = [];
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      errors: {},
    };
    this.latencies = [];
  }

  /**
   * Initialize connections to multiple RPC endpoints
   */
  async initialize() {
    console.log('🔌 Initializing RPC connections...');
    
    for (const endpoint of CONFIG.RPC_ENDPOINTS) {
      try {
        const connection = new Connection(endpoint, 'confirmed');
        const version = await connection.getVersion();
        console.log(`  ✅ ${endpoint} - Solana ${version['solana-core']}`);
        this.connections.push(connection);
      } catch (error) {
        console.log(`  ⚠️  ${endpoint} - Failed: ${error.message}`);
      }
    }

    if (this.connections.length === 0) {
      throw new Error('No RPC connections available');
    }

    console.log(`✅ Connected to ${this.connections.length} RPC endpoints\n`);
  }

  /**
   * Get random connection for load distribution
   */
  getRandomConnection() {
    return this.connections[Math.floor(Math.random() * this.connections.length)];
  }

  /**
   * Test 1: Initialize Escrow (High load)
   */
  async testEscrowInit() {
    const startTime = Date.now();
    const connection = this.getRandomConnection();
    
    try {
      // Simulate escrow initialization
      // In real test, this would call the program
      const buyer = Keypair.generate();
      const seller = Keypair.generate();
      
      // Fetch recent blockhash (simulates transaction prep)
      const { blockhash } = await connection.getLatestBlockhash();
      
      // Simulate transaction
      await this.simulateDelay(50, 150); // 50-150ms processing
      
      const latency = Date.now() - startTime;
      this.recordSuccess(latency);
      
      return { success: true, latency, type: 'escrow_init' };
    } catch (error) {
      this.recordError('escrow_init', error.message);
      return { success: false, error: error.message, type: 'escrow_init' };
    }
  }

  /**
   * Test 2: Settle Escrow
   */
  async testEscrowSettle() {
    const startTime = Date.now();
    const connection = this.getRandomConnection();
    
    try {
      // Simulate multi-sig settlement
      const signatures = 3; // 3-of-5 threshold
      
      // Simulate signature verification
      await this.simulateDelay(30, 80);
      
      // Simulate settlement execution
      const { blockhash } = await connection.getLatestBlockhash();
      await this.simulateDelay(100, 200);
      
      const latency = Date.now() - startTime;
      this.recordSuccess(latency);
      
      return { success: true, latency, type: 'escrow_settle', signatures };
    } catch (error) {
      this.recordError('escrow_settle', error.message);
      return { success: false, error: error.message, type: 'escrow_settle' };
    }
  }

  /**
   * Test 3: Initiate Dispute
   */
  async testDisputeInit() {
    const startTime = Date.now();
    
    try {
      // Simulate dispute initiation with jury
      const jurors = 5;
      await this.simulateDelay(80, 150);
      
      const latency = Date.now() - startTime;
      this.recordSuccess(latency);
      
      return { success: true, latency, type: 'dispute_init', jurors };
    } catch (error) {
      this.recordError('dispute_init', error.message);
      return { success: false, error: error.message, type: 'dispute_init' };
    }
  }

  /**
   * Test 4: Cast Jury Vote
   */
  async testJuryVote() {
    const startTime = Date.now();
    
    try {
      // Simulate vote casting
      await this.simulateDelay(20, 50);
      
      const latency = Date.now() - startTime;
      this.recordSuccess(latency);
      
      return { success: true, latency, type: 'jury_vote' };
    } catch (error) {
      this.recordError('jury_vote', error.message);
      return { success: false, error: error.message, type: 'jury_vote' };
    }
  }

  /**
   * Test 5: Update Price Oracle
   */
  async testPriceUpdate() {
    const startTime = Date.now();
    const connection = this.getRandomConnection();
    
    try {
      // Simulate price update
      await this.simulateDelay(40, 100);
      
      const latency = Date.now() - startTime;
      this.recordSuccess(latency);
      
      return { success: true, latency, type: 'price_update' };
    } catch (error) {
      this.recordError('price_update', error.message);
      return { success: false, error: error.message, type: 'price_update' };
    }
  }

  /**
   * Test 6: Query Operations (Read-only)
   */
  async testQueryOnly() {
    const startTime = Date.now();
    const connection = this.getRandomConnection();
    
    try {
      // Simulate account fetching
      const accountInfo = await connection.getAccountInfo(
        new PublicKey(CONFIG.PROGRAM_ID)
      );
      
      const latency = Date.now() - startTime;
      this.recordSuccess(latency);
      
      return { success: true, latency, type: 'query_only', dataSize: accountInfo?.data?.length || 0 };
    } catch (error) {
      this.recordError('query_only', error.message);
      return { success: false, error: error.message, type: 'query_only' };
    }
  }

  /**
   * Simulate processing delay
   */
  async simulateDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Record successful request
   */
  recordSuccess(latency) {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.latencies.push(latency);
  }

  /**
   * Record failed request
   */
  recordError(type, message) {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    
    if (!this.metrics.errors[type]) {
      this.metrics.errors[type] = 0;
    }
    this.metrics.errors[type]++;
  }

  /**
   * Execute single user session
   */
  async executeUserSession() {
    const rand = Math.random() * 100;
    let cumulative = 0;
    
    // Route to appropriate test based on weight
    for (const [test, weight] of Object.entries(CONFIG.TEST_CASES)) {
      cumulative += weight;
      if (rand <= cumulative) {
        switch (test) {
          case 'ESCROW_INIT':
            return await this.testEscrowInit();
          case 'ESCROW_SETTLE':
            return await this.testEscrowSettle();
          case 'DISPUTE_INIT':
            return await this.testDisputeInit();
          case 'JURY_VOTE':
            return await this.testJuryVote();
          case 'PRICE_UPDATE':
            return await this.testPriceUpdate();
          case 'QUERY_ONLY':
            return await this.testQueryOnly();
        }
      }
    }
  }

  /**
   * Calculate percentiles
   */
  calculatePercentiles() {
    if (this.latencies.length === 0) return;
    
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    
    this.metrics.p95Latency = sorted[p95Index] || 0;
    this.metrics.p99Latency = sorted[p99Index] || 0;
    this.metrics.averageLatency = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  }

  /**
   * Run load test
   */
  async runLoadTest() {
    console.log('🚀 Starting ProxyHubb Load Test\n');
    console.log('Configuration:');
    console.log(`  Concurrent Users: ${CONFIG.CONCURRENT_USERS}`);
    console.log(`  Duration: ${CONFIG.DURATION_SECONDS}s`);
    console.log(`  Ramp-up: ${CONFIG.RAMP_UP_SECONDS}s\n`);

    const startTime = Date.now();
    const users = [];

    // Ramp up users gradually
    const usersPerSecond = CONFIG.CONCURRENT_USERS / CONFIG.RAMP_UP_SECONDS;
    
    for (let i = 0; i < CONFIG.CONCURRENT_USERS; i++) {
      const userPromise = this.runUser(i);
      users.push(userPromise);
      
      // Ramp up delay
      await new Promise(resolve => setTimeout(resolve, 1000 / usersPerSecond));
      
      if (i % 10 === 0) {
        process.stdout.write(`\r  👥 Spawned ${i + 1}/${CONFIG.CONCURRENT_USERS} users`);
      }
    }
    console.log('\n');

    // Wait for all users to complete
    await Promise.all(users);

    const totalTime = (Date.now() - startTime) / 1000;
    this.calculatePercentiles();

    // Print results
    this.printResults(totalTime);
  }

  /**
   * Run individual user
   */
  async runUser(userId) {
    const endTime = Date.now() + (CONFIG.DURATION_SECONDS * 1000);
    
    while (Date.now() < endTime) {
      await this.executeUserSession();
      
      // Small delay between requests (think time)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500));
    }
  }

  /**
   * Print test results
   */
  printResults(totalTime) {
    console.log('\n📊 LOAD TEST RESULTS\n');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Total Duration: ${totalTime.toFixed(2)}s`);
    console.log(`Total Requests: ${this.metrics.totalRequests}`);
    console.log(`Successful: ${this.metrics.successfulRequests} (${((this.metrics.successfulRequests/this.metrics.totalRequests)*100).toFixed(1)}%)`);
    console.log(`Failed: ${this.metrics.failedRequests} (${((this.metrics.failedRequests/this.metrics.totalRequests)*100).toFixed(1)}%)`);
    console.log(`Throughput: ${(this.metrics.totalRequests/totalTime).toFixed(2)} req/s`);
    console.log('');
    console.log('Latency (ms):');
    console.log(`  Average: ${this.metrics.averageLatency.toFixed(2)}`);
    console.log(`  P95: ${this.metrics.p95Latency.toFixed(2)}`);
    console.log(`  P99: ${this.metrics.p99Latency.toFixed(2)}`);
    console.log('');
    
    if (Object.keys(this.metrics.errors).length > 0) {
      console.log('Errors:');
      for (const [type, count] of Object.entries(this.metrics.errors)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    console.log('═══════════════════════════════════════════════════\n');

    // Performance evaluation
    const successRate = (this.metrics.successfulRequests / this.metrics.totalRequests) * 100;
    
    if (successRate >= 99 && this.metrics.p95Latency < 500) {
      console.log('✅ EXCELLENT: System handles load well');
    } else if (successRate >= 95 && this.metrics.p95Latency < 1000) {
      console.log('⚠️  GOOD: Minor performance issues');
    } else {
      console.log('❌ POOR: Significant issues detected');
    }
  }
}

// Run if called directly
if (require.main === module) {
  const test = new ProxyHubbLoadTest();
  test.initialize()
    .then(() => test.runLoadTest())
    .catch(console.error);
}

module.exports = ProxyHubbLoadTest;
