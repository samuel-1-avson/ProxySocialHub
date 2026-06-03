package models

import "testing"

func TestOrderStatusTransitions(t *testing.T) {
	tests := []struct {
		name string
		from OrderStatus
		to   OrderStatus
		want bool
	}{
		{"new pending", "", OrderStatusPending, true},
		{"pending active", OrderStatusPending, OrderStatusActive, true},
		{"pending refunded", OrderStatusPending, OrderStatusRefunded, true},
		{"pending payment active", OrderStatusPendingPayment, OrderStatusActive, true},
		{"pending payment refunded", OrderStatusPendingPayment, OrderStatusRefunded, true},
		{"active completed", OrderStatusActive, OrderStatusCompleted, true},
		{"active disputed", OrderStatusActive, OrderStatusDisputed, true},
		{"active cancelled", OrderStatusActive, OrderStatusCancelled, true},
		{"active refunded", OrderStatusActive, OrderStatusRefunded, true},
		{"disputed refunded", OrderStatusDisputed, OrderStatusRefunded, true},
		{"disputed completed", OrderStatusDisputed, OrderStatusCompleted, true},
		{"completed active blocked", OrderStatusCompleted, OrderStatusActive, false},
		{"cancelled active blocked", OrderStatusCancelled, OrderStatusActive, false},
		{"refunded active blocked", OrderStatusRefunded, OrderStatusActive, false},
		{"cancelled cancelled blocked", OrderStatusCancelled, OrderStatusCancelled, false},
		{"completed refunded blocked", OrderStatusCompleted, OrderStatusRefunded, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CanTransitionOrderStatus(tt.from, tt.to)
			if got != tt.want {
				t.Fatalf("CanTransitionOrderStatus(%q, %q)=%v, want %v", tt.from, tt.to, got, tt.want)
			}
			err := ValidateOrderStatusTransition(tt.from, tt.to)
			if tt.want && err != nil {
				t.Fatalf("expected valid transition, got %v", err)
			}
			if !tt.want && err == nil {
				t.Fatal("expected invalid transition error")
			}
		})
	}
}

func TestListingStatusTransitions(t *testing.T) {
	tests := []struct {
		name string
		from ListingStatus
		to   ListingStatus
		want bool
	}{
		{"new active", "", ListingStatusActive, true},
		{"new pending review", "", ListingStatusPendingReview, true},
		{"pending approve", ListingStatusPendingReview, ListingStatusActive, true},
		{"pending reject", ListingStatusPendingReview, ListingStatusDeleted, true},
		{"active paused", ListingStatusActive, ListingStatusPaused, true},
		{"active sold out", ListingStatusActive, ListingStatusSoldOut, true},
		{"active deleted", ListingStatusActive, ListingStatusDeleted, true},
		{"paused active", ListingStatusPaused, ListingStatusActive, true},
		{"paused deleted", ListingStatusPaused, ListingStatusDeleted, true},
		{"sold out active", ListingStatusSoldOut, ListingStatusActive, true},
		{"sold out deleted", ListingStatusSoldOut, ListingStatusDeleted, true},
		{"deleted active blocked", ListingStatusDeleted, ListingStatusActive, false},
		{"deleted paused blocked", ListingStatusDeleted, ListingStatusPaused, false},
		{"deleted deleted blocked", ListingStatusDeleted, ListingStatusDeleted, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CanTransitionListingStatus(tt.from, tt.to)
			if got != tt.want {
				t.Fatalf("CanTransitionListingStatus(%q, %q)=%v, want %v", tt.from, tt.to, got, tt.want)
			}
			err := ValidateListingStatusTransition(tt.from, tt.to)
			if tt.want && err != nil {
				t.Fatalf("expected valid transition, got %v", err)
			}
			if !tt.want && err == nil {
				t.Fatal("expected invalid transition error")
			}
		})
	}
}

func TestSessionStatusTransitions(t *testing.T) {
	tests := []struct {
		name string
		from SessionStatus
		to   SessionStatus
		want bool
	}{
		{"new active", "", SessionActive, true},
		{"active disabled", SessionActive, SessionDisabled, true},
		{"active terminated", SessionActive, SessionTerminated, true},
		{"disabled active", SessionDisabled, SessionActive, true},
		{"disabled terminated", SessionDisabled, SessionTerminated, true},
		{"terminated active blocked", SessionTerminated, SessionActive, false},
		{"terminated disabled blocked", SessionTerminated, SessionDisabled, false},
		{"terminated terminated blocked", SessionTerminated, SessionTerminated, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CanTransitionSessionStatus(tt.from, tt.to)
			if got != tt.want {
				t.Fatalf("CanTransitionSessionStatus(%q, %q)=%v, want %v", tt.from, tt.to, got, tt.want)
			}
			err := ValidateSessionStatusTransition(tt.from, tt.to)
			if tt.want && err != nil {
				t.Fatalf("expected valid transition, got %v", err)
			}
			if !tt.want && err == nil {
				t.Fatal("expected invalid transition error")
			}
		})
	}
}
