package worker

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

type AgentWorker struct {
	stopChan chan struct{}
}

func NewAgentWorker() *AgentWorker {
	return &AgentWorker{
		stopChan: make(chan struct{}),
	}
}

// Start initiates the worker loop (blocking)
func (w *AgentWorker) Start(ctx context.Context) {
	log.Println("[AgentWorker] Starting AI execution loop (Redis Queue)...")

	for {
		select {
		case <-ctx.Done():
			log.Println("[AgentWorker] Shutting down...")
			return
		case <-w.stopChan:
			return
		default:
			// BLPOP from Redis queue (blocking for 5 seconds)
			if redisClient.Client == nil {
				time.Sleep(5 * time.Second)
				continue
			}

			// We use a simple list for MVP instead of a complex queue library
			// LPop or BLPop. go-redis interface might need cast or use raw.
			// Let's assume BLPop exists in interface or we use LPop with sleep.
			val, err := redisClient.Client.LRange(ctx, AgentJobQueueKey, -1, -1).Result()
			if err != nil || len(val) == 0 {
				time.Sleep(2 * time.Second)
				continue
			}

			// Remove it (since we can't atomically RPop with the interface easily)
			_ = redisClient.Client.LTrim(ctx, AgentJobQueueKey, 0, -2)

			rawMsg := val[0]
			var task map[string]interface{}
			if err := json.Unmarshal([]byte(rawMsg), &task); err != nil {
				log.Printf("[AgentWorker] Failed to unmarshal task: %v", err)
				continue
			}

			jobIDStr := task["job_id"].(string)
			jobID, _ := uuid.Parse(jobIDStr)

			w.processJob(ctx, jobID, task)
		}
	}
}

func (w *AgentWorker) processJob(ctx context.Context, jobID uuid.UUID, task map[string]interface{}) {
	log.Printf("[AgentWorker] Processing JobID=%s", jobID)

	// 1. Update status to 'running'
	db.DB.Model(&models.AgentJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"status":     "running",
		"started_at": time.Now(),
	})

	// 2. SIMULATE Docker Execution (Phase 13 Runtime)
	// In production, this would call Docker SDK to run the image
	time.Sleep(5 * time.Second)

	result := map[string]interface{}{
		"status":      "success",
		"output":      "Simulated analysis complete for image: " + task["docker_image"].(string),
		"token_usage": 1500,
	}

	// 3. Update status to 'completed'
	logs := "Container spawned...\nExecuting agent script...\nGenerated result: " + result["output"].(string)

	db.DB.Model(&models.AgentJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"status":       "completed",
		"result":       result,
		"logs":         logs,
		"completed_at": time.Now(),
		"duration_sec": 5.0,
	})

	log.Printf("[AgentWorker] Completed JobID=%s", jobID)
}
