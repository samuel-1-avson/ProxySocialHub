# Optimization Plan: Usage & SQL Performance

## 1. Problem Analysis
- **Symptom**: `GET /v1/usage/me` takes ~1.9s. User reports "SLOW SQL >= 200ms".
- **Root Cause**: 
    1. **N+1 Redis Problem**: `getUserUsage` fetches all sessions (e.g., 50+) and calls `redisClient.GetUsage` sequentially for *each* one.
    2. **Unbounded SQL Query**: The query `db.DB.Find(&sessions)` fetches *all* historical sessions (terminated, active, etc.). As history grows, this gets slower.
    3. **Misidentified Bottleneck**: The 200ms SQL might be real (if table is large), but the 1.9s total time is dominated by the sequential Redis RTTs.

## 2. Proposed Solution

### A. SQL Optimization (The "Slow SQL" Fix)
- **Action**: Modify `getUserUsage` to accept a `status` filter (default to `active`) or implement pagination.
- **Why**: Fetching 5 active sessions is instant. Fetching 10,000 terminated sessions is slow.
- **SQL Change**:
    ```go
    // db.DB.Where("user_id = ?", userID).Find(&sessions) // OLD
    db.DB.Where("user_id = ? AND status = ?", userID, "active").Find(&sessions) // NEW
    // OR Pagination if "all" is needed
    ```

### B. Redis Optimization (The "1.9s" Fix)
- **Action**: Use **Redis Pipelining** or **MGET**.
- **Change**: Instead of a loop of `GetUsage()`, construct a pipeline to fetch all usage keys in a single round-trip.
- **Impact**: Reduces 50 x 10ms (500ms) to 1 x 10ms (10ms).

## 3. Implementation Steps
1.  **Refactor `redis/client.go`**: Add `GetBatchUsage(usernames []string) (map[string]int64, error)`.
2.  **Refactor `api/usage.go`**: 
    - Update `getUserUsage` to use `GetBatchUsage`.
    - Add `?status=active` query param support.

## 4. Verification
- **Benchmark**: Run `GET /v1/usage/me` before and after. Target: < 100ms.
- **SQL Check**: Verify no GORM "Slow SQL" warnings appear.
