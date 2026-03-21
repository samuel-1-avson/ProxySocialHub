import asyncio
import time
import requests
import statistics
from proxyhubb import ProxyClient

# Configuration for High-Performance Benchmark
GATEWAY_URL = "http://localhost:3128"
CONCURRENT_SESSIONS = 50
REQUESTS_PER_SESSION = 5
TARGET_URL = "http://httpbin.org/get"

async def run_session(session_id: int):
    client = ProxyClient(GATEWAY_URL, f"user_{session_id}", "pass")
    latencies = []
    
    for _ in range(REQUESTS_PER_SESSION):
        start = time.perf_counter()
        try:
            # P9-W22: Using SDK with automatic rotation and ML-routing
            response = await asyncio.to_thread(client.get, TARGET_URL)
            if response.status_code == 200:
                latencies.append(time.perf_counter() - start)
        except Exception as e:
            print(f"Session {session_id} Error: {e}")
            
    return latencies

async def main():
    print(f"🚀 Starting High-Performance Load Test: {CONCURRENT_SESSIONS} Sessions...")
    start_all = time.perf_counter()
    
    tasks = [run_session(i) for i in range(CONCURRENT_SESSIONS)]
    results = await asyncio.gather(*tasks)
    
    total_duration = time.perf_counter() - start_all
    all_latencies = [l for r in results for l in r]
    
    if all_latencies:
        avg_lat = statistics.mean(all_latencies) * 1000
        p95_lat = statistics.quantiles(all_latencies, n=20)[18] * 1000
        
        print("\n--- Phase 9 Performance Results ---")
        print(f"Total Requests: {len(all_latencies)}")
        print(f"Total Duration: {total_duration:.2f}s")
        print(f"Throughput:     {len(all_latencies)/total_duration:.2f} req/s")
        print(f"Avg Latency:    {avg_lat:.2f}ms")
        print(f"P95 Latency:    {p95_lat:.2f}ms")
        print("-----------------------------------\n")
    else:
        print("❌ No successful requests recorded.")

if __name__ == "__main__":
    asyncio.run(main())
