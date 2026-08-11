package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// RegisterUserOnboardingRoutes registers first-run onboarding state + events.
func RegisterUserOnboardingRoutes(rg *gin.RouterGroup) {
	rg.GET("/onboarding", getUserOnboarding)
	rg.PUT("/onboarding", putUserOnboarding)
	rg.POST("/onboarding/events", postOnboardingEvent)
}

type onboardingStepMeta struct {
	CompletedAt string                 `json:"completed_at,omitempty"`
	Meta        map[string]interface{} `json:"meta,omitempty"`
}

type onboardingStateResponse struct {
	UserID        string                         `json:"user_id"`
	Intent        *string                        `json:"intent,omitempty"`
	CurrentStep   string                         `json:"current_step"`
	Steps         map[string]onboardingStepMeta  `json:"steps"`
	StepCatalog   []string                       `json:"step_catalog"`
	CompletedAt   *time.Time                     `json:"completed_at,omitempty"`
	DismissedAt   *time.Time                     `json:"dismissed_at,omitempty"`
	NeedsOnboarding bool                         `json:"needs_onboarding"`
	KYCStatus     models.KYCStatus               `json:"kyc_status"`
	Role          string                         `json:"role"`
	WalletAddress *string                        `json:"wallet_address,omitempty"`
	UpdatedAt     time.Time                      `json:"updated_at"`
}

type putOnboardingRequest struct {
	Intent       *string                `json:"intent"`
	CurrentStep  *string                `json:"current_step"`
	CompleteStep *string                `json:"complete_step"`
	StepMeta     map[string]interface{} `json:"step_meta"`
	Dismiss      *bool                  `json:"dismiss"`
	Resume       *bool                  `json:"resume"`
	Complete     *bool                  `json:"complete"`
}

type postOnboardingEventRequest struct {
	EventName string                 `json:"event_name" binding:"required"`
	Surface   string                 `json:"surface"`
	Meta      map[string]interface{} `json:"meta"`
}

func getUserOnboarding(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var user models.User
	if err := db.DB.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	row, created, err := ensureUserOnboarding(userID)
	if err != nil {
		logging.Error(err).Str("user_id", userID.String()).Msg("Failed to load onboarding state")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load onboarding"})
		return
	}

	// Fire started once when the row is first created.
	if created {
		recordOnboardingEvent(c.Request.Context(), userID, models.OnboardingEventStarted, "onboarding", nil)
	}

	c.JSON(http.StatusOK, buildOnboardingResponse(user, row))
}

func putUserOnboarding(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req putOnboardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	var user models.User
	if err := db.DB.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	row, _, err := ensureUserOnboarding(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load onboarding"})
		return
	}

	stepsMap := decodeOnboardingSteps(row.Steps)
	now := time.Now().UTC()

	if req.Intent != nil {
		if !models.IsValidOnboardingIntent(*req.Intent) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid intent"})
			return
		}
		row.Intent = req.Intent
		stepsMap[models.OnboardingStepIntent] = onboardingStepMeta{
			CompletedAt: now.Format(time.RFC3339),
			Meta:        map[string]interface{}{"intent": *req.Intent},
		}
		recordOnboardingEvent(c.Request.Context(), userID, models.OnboardingEventIntentSelected, "onboarding", map[string]interface{}{
			"intent": *req.Intent,
		})
		// Advance past intent if still on intent step.
		if row.CurrentStep == models.OnboardingStepIntent {
			row.CurrentStep = models.OnboardingStepWallet
		}
	}

	if req.CompleteStep != nil {
		step := *req.CompleteStep
		if !models.IsValidOnboardingStep(step) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid complete_step"})
			return
		}
		// Provider hard gate: cannot complete apply (or later provider steps) without KYC approved.
		if isProviderGatedStep(step) && user.KYCStatus != models.KYCStatusApproved {
			c.JSON(http.StatusForbidden, gin.H{
				"error":      "KYC approval required before this step",
				"kyc_status": user.KYCStatus,
				"step":       step,
			})
			return
		}
		meta := onboardingStepMeta{
			CompletedAt: now.Format(time.RFC3339),
			Meta:        req.StepMeta,
		}
		stepsMap[step] = meta
		recordOnboardingEvent(c.Request.Context(), userID, models.OnboardingEventStepCompleted, "onboarding", map[string]interface{}{
			"step": step,
		})
		// Advance current_step to next incomplete in catalog.
		row.CurrentStep = nextIncompleteStep(stringPtrValue(row.Intent), stepsMap, step)
	}

	if req.CurrentStep != nil {
		if !models.IsValidOnboardingStep(*req.CurrentStep) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid current_step"})
			return
		}
		row.CurrentStep = *req.CurrentStep
	}

	if req.Dismiss != nil && *req.Dismiss {
		row.DismissedAt = &now
		recordOnboardingEvent(c.Request.Context(), userID, models.OnboardingEventDismissed, "onboarding", nil)
	}

	if req.Resume != nil && *req.Resume {
		row.DismissedAt = nil
		recordOnboardingEvent(c.Request.Context(), userID, models.OnboardingEventResumed, "onboarding", map[string]interface{}{
			"current_step": row.CurrentStep,
		})
	}

	if req.Complete != nil && *req.Complete {
		row.CompletedAt = &now
		row.DismissedAt = nil
		recordOnboardingEvent(c.Request.Context(), userID, models.OnboardingEventCompleted, "onboarding", map[string]interface{}{
			"intent": stringPtrValue(row.Intent),
		})
	}

	encoded, err := json.Marshal(stepsMap)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to encode steps"})
		return
	}
	row.Steps = datatypes.JSON(encoded)
	row.UpdatedAt = now

	if err := db.DB.Save(&row).Error; err != nil {
		logging.Error(err).Str("user_id", userID.String()).Msg("Failed to save onboarding")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save onboarding"})
		return
	}

	c.JSON(http.StatusOK, buildOnboardingResponse(user, row))
}

func postOnboardingEvent(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req postOnboardingEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if !models.IsValidOnboardingEventName(req.EventName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid event_name"})
		return
	}

	recordOnboardingEvent(c.Request.Context(), userID, req.EventName, req.Surface, req.Meta)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func ensureUserOnboarding(userID uuid.UUID) (models.UserOnboarding, bool, error) {
	var row models.UserOnboarding
	err := db.DB.Where("user_id = ?", userID).First(&row).Error
	if err == nil {
		return row, false, nil
	}
	if err != gorm.ErrRecordNotFound {
		return row, false, err
	}
	now := time.Now().UTC()
	row = models.UserOnboarding{
		UserID:      userID,
		CurrentStep: models.OnboardingStepIntent,
		Steps:       datatypes.JSON([]byte("{}")),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := db.DB.Create(&row).Error; err != nil {
		return row, false, err
	}
	return row, true, nil
}

func buildOnboardingResponse(user models.User, row models.UserOnboarding) onboardingStateResponse {
	intent := stringPtrValue(row.Intent)
	return onboardingStateResponse{
		UserID:          user.ID.String(),
		Intent:          row.Intent,
		CurrentStep:     row.CurrentStep,
		Steps:           decodeOnboardingSteps(row.Steps),
		StepCatalog:     models.StepsForIntent(intent),
		CompletedAt:     row.CompletedAt,
		DismissedAt:     row.DismissedAt,
		NeedsOnboarding: row.CompletedAt == nil && row.DismissedAt == nil,
		KYCStatus:       user.KYCStatus,
		Role:            user.Role,
		WalletAddress:   user.WalletAddress,
		UpdatedAt:       row.UpdatedAt,
	}
}

func decodeOnboardingSteps(raw datatypes.JSON) map[string]onboardingStepMeta {
	out := map[string]onboardingStepMeta{}
	if len(raw) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	if out == nil {
		return map[string]onboardingStepMeta{}
	}
	return out
}

func nextIncompleteStep(intent string, completed map[string]onboardingStepMeta, justCompleted string) string {
	catalog := models.StepsForIntent(intent)
	foundJust := justCompleted == ""
	for _, step := range catalog {
		if !foundJust {
			if step == justCompleted {
				foundJust = true
			}
			continue
		}
		if _, ok := completed[step]; !ok {
			return step
		}
	}
	// All remaining done — stay on last completed or last catalog step.
	if len(catalog) == 0 {
		return models.OnboardingStepIntent
	}
	return catalog[len(catalog)-1]
}

func isProviderGatedStep(step string) bool {
	switch step {
	case models.OnboardingStepApply, models.OnboardingStepToken, models.OnboardingStepNode, models.OnboardingStepOnline:
		return true
	default:
		return false
	}
}

func stringPtrValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func recordOnboardingEvent(_ context.Context, userID uuid.UUID, eventName, surface string, meta map[string]interface{}) {
	if !models.IsValidOnboardingEventName(eventName) {
		return
	}
	if meta == nil {
		meta = map[string]interface{}{}
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		metaJSON = []byte("{}")
	}
	uid := userID
	go func() {
		row := models.OnboardingFunnelEvent{
			SchemaVersion: models.OnboardingFunnelSchemaV1,
			EventName:     eventName,
			UserID:        &uid,
			Surface:       surface,
			Meta:          datatypes.JSON(metaJSON),
		}
		if err := db.DB.WithContext(context.Background()).Create(&row).Error; err != nil {
			logging.Warn().Err(err).Str("event_name", eventName).Msg("Failed to record onboarding funnel event")
		}
	}()
}

// syncOnboardingAfterKYCApproved marks the KYC onboarding step complete when present.
func syncOnboardingAfterKYCApproved(userID uuid.UUID, previousStatus models.KYCStatus) {
	recordOnboardingEvent(context.Background(), userID, models.OnboardingEventKYCStatusChanged, "kyc", map[string]interface{}{
		"from": string(previousStatus),
		"to":   string(models.KYCStatusApproved),
	})

	row, _, err := ensureUserOnboarding(userID)
	if err != nil {
		return
	}
	if row.CompletedAt != nil || row.DismissedAt != nil {
		return
	}
	stepsMap := decodeOnboardingSteps(row.Steps)
	if _, done := stepsMap[models.OnboardingStepKYC]; done {
		return
	}
	now := time.Now().UTC()
	stepsMap[models.OnboardingStepKYC] = onboardingStepMeta{
		CompletedAt: now.Format(time.RFC3339),
		Meta:        map[string]interface{}{"source": "kyc_approval"},
	}
	if row.CurrentStep == models.OnboardingStepKYC {
		row.CurrentStep = nextIncompleteStep(stringPtrValue(row.Intent), stepsMap, models.OnboardingStepKYC)
	}
	encoded, err := json.Marshal(stepsMap)
	if err != nil {
		return
	}
	row.Steps = datatypes.JSON(encoded)
	row.UpdatedAt = now
	_ = db.DB.Save(&row).Error
	recordOnboardingEvent(context.Background(), userID, models.OnboardingEventStepCompleted, "kyc", map[string]interface{}{
		"step": models.OnboardingStepKYC,
	})
}
