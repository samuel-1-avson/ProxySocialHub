package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

const OnboardingFunnelSchemaV1 = "onboarding.funnel.v1"

// Onboarding intents (preference only — not JWT role).
const (
	OnboardingIntentBuyer    = "buyer"
	OnboardingIntentProvider = "provider"
	OnboardingIntentBoth     = "both"
)

// Onboarding step IDs (shared buyer + provider catalog).
const (
	OnboardingStepIntent  = "intent"
	OnboardingStepWallet  = "wallet"
	OnboardingStepKYC     = "kyc"
	OnboardingStepApply   = "apply"
	OnboardingStepToken   = "token"
	OnboardingStepNode    = "node"
	OnboardingStepOnline  = "online"
	OnboardingStepProfile = "profile"
	OnboardingStepFund    = "fund"
	OnboardingStepBrowse  = "browse"
	OnboardingStepSession = "session"
)

// Onboarding funnel event names (schema onboarding.funnel.v1).
const (
	OnboardingEventStarted              = "onboarding_started"
	OnboardingEventIntentSelected       = "intent_selected"
	OnboardingEventWalletConfirmed      = "wallet_confirmed"
	OnboardingEventKYCViewed            = "kyc_viewed"
	OnboardingEventKYCStatusChanged     = "kyc_status_changed"
	OnboardingEventProviderApplySubmit  = "provider_apply_submitted"
	OnboardingEventProviderApplyResult  = "provider_apply_result"
	OnboardingEventTokenCreated         = "token_created"
	OnboardingEventNodeRegistered       = "node_registered"
	OnboardingEventNodeOnline           = "node_online"
	OnboardingEventBuyerMarketplaceOpen = "buyer_marketplace_opened"
	OnboardingEventCompleted            = "onboarding_completed"
	OnboardingEventDismissed            = "onboarding_dismissed"
	OnboardingEventResumed              = "onboarding_resumed"
	OnboardingEventBannerShown          = "onboarding_banner_shown"
	OnboardingEventNudgeClicked         = "onboarding_nudge_clicked"
	OnboardingEventStepCompleted        = "step_completed"
	OnboardingEventStepViewed           = "step_viewed"
)

// UserOnboarding stores first-run progress for a profile.
type UserOnboarding struct {
	UserID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"user_id"`
	Intent        *string        `gorm:"size:20" json:"intent,omitempty"`
	CurrentStep   string         `gorm:"size:40;not null;default:intent" json:"current_step"`
	Steps         datatypes.JSON `gorm:"type:jsonb;not null;default:'{}'" json:"steps"`
	CompletedAt   *time.Time     `json:"completed_at,omitempty"`
	DismissedAt   *time.Time     `json:"dismissed_at,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

func (UserOnboarding) TableName() string {
	return "user_onboarding"
}

// OnboardingFunnelEvent is an append-only onboarding conversion event.
type OnboardingFunnelEvent struct {
	ID            uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SchemaVersion string         `gorm:"column:schema_version;not null;default:onboarding.funnel.v1" json:"schema_version"`
	EventName     string         `gorm:"column:event_name;not null;index" json:"event_name"`
	UserID        *uuid.UUID     `gorm:"type:uuid;index" json:"user_id,omitempty"`
	Surface       string         `gorm:"column:surface" json:"surface,omitempty"`
	Meta          datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"meta"`
	CreatedAt     time.Time      `gorm:"index" json:"created_at"`
}

func (OnboardingFunnelEvent) TableName() string {
	return "onboarding_funnel_events"
}

func IsValidOnboardingIntent(intent string) bool {
	switch intent {
	case OnboardingIntentBuyer, OnboardingIntentProvider, OnboardingIntentBoth:
		return true
	default:
		return false
	}
}

func IsValidOnboardingStep(step string) bool {
	switch step {
	case OnboardingStepIntent, OnboardingStepWallet, OnboardingStepKYC, OnboardingStepApply,
		OnboardingStepToken, OnboardingStepNode, OnboardingStepOnline,
		OnboardingStepProfile, OnboardingStepFund, OnboardingStepBrowse, OnboardingStepSession:
		return true
	default:
		return false
	}
}

func IsValidOnboardingEventName(name string) bool {
	switch name {
	case OnboardingEventStarted, OnboardingEventIntentSelected, OnboardingEventWalletConfirmed,
		OnboardingEventKYCViewed, OnboardingEventKYCStatusChanged,
		OnboardingEventProviderApplySubmit, OnboardingEventProviderApplyResult,
		OnboardingEventTokenCreated, OnboardingEventNodeRegistered, OnboardingEventNodeOnline,
		OnboardingEventBuyerMarketplaceOpen, OnboardingEventCompleted, OnboardingEventDismissed,
		OnboardingEventResumed, OnboardingEventBannerShown, OnboardingEventNudgeClicked,
		OnboardingEventStepCompleted, OnboardingEventStepViewed:
		return true
	default:
		return false
	}
}

// ProviderSteps returns the ordered provider path (includes shared prefix).
func ProviderOnboardingSteps() []string {
	return []string{
		OnboardingStepIntent,
		OnboardingStepWallet,
		OnboardingStepKYC,
		OnboardingStepApply,
		OnboardingStepToken,
		OnboardingStepNode,
		OnboardingStepOnline,
	}
}

// BuyerOnboardingSteps returns the ordered buyer path.
func BuyerOnboardingSteps() []string {
	return []string{
		OnboardingStepIntent,
		OnboardingStepWallet,
		OnboardingStepProfile,
		OnboardingStepFund,
		OnboardingStepBrowse,
		OnboardingStepSession,
	}
}

// StepsForIntent returns the checklist for an intent.
// "both" runs the provider path, then buyer profile/fund/browse/session.
func StepsForIntent(intent string) []string {
	switch intent {
	case OnboardingIntentProvider:
		return ProviderOnboardingSteps()
	case OnboardingIntentBuyer:
		return BuyerOnboardingSteps()
	case OnboardingIntentBoth:
		provider := ProviderOnboardingSteps()
		return append(provider,
			OnboardingStepProfile,
			OnboardingStepFund,
			OnboardingStepBrowse,
			OnboardingStepSession,
		)
	default:
		return []string{OnboardingStepIntent}
	}
}
