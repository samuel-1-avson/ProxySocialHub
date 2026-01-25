package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

const AgentJobQueueKey = "queue:agent:jobs"

type AgentTaskDispatcher struct{}

func NewAgentTaskDispatcher() *AgentTaskDispatcher {
	return &AgentTaskDispatcher{}
}

// DispatchJob pushes an AgentJob to the Redis queue for async execution
func (d *AgentTaskDispatcher) DispatchJob(ctx context.Context, jobID uuid.UUID) error {
	// 1. Fetch Job from DB to verify it's still pending
	var job models.AgentJob
	if err := db.DB.Preload("AgentInstance.MarketAgent").First(&job, "id = ?", jobID).Error; err != nil {
		return fmt.Errorf("job not found: %w", err)
	}

	if job.Status != "pending" {
		return fmt.Errorf("job is already in state: %s", job.Status)
	}

	// 2. Prepare Task Payload
	payload := map[string]interface{}{
		"job_id":        job.ID.String(),
		"instance_id":   job.AgentInstanceID.String(),
		"docker_image":  job.AgentInstance.MarketAgent.DockerImage,
		"config":        job.AgentInstance.Config,
		"dispatched_at": time.Now().Unix(),
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	// 3. Push to Redis (RPush to the tail of the list)
	if redisClient.Client == nil {
		return fmt.Errorf("redis client not initialized")
	}

	err = redisClient.Client.LPush(ctx, AgentJobQueueKey, jsonPayload).Err()
	if err != nil {
		return fmt.Errorf("failed to queue job in redis: %w", err)
	}

	// 4. Update Job Status to 'queued'
	db.DB.Model(&job).Update("status", "queued")

	log.Printf("[AgentDispatcher] Dispatched JobID=%s Image=%s", job.ID, job.AgentInstance.MarketAgent.DockerImage)
	return nil
}
