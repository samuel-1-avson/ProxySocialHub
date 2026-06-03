package models

import "fmt"

func (s OrderStatus) IsTerminal() bool {
	switch s {
	case OrderStatusCompleted, OrderStatusRefunded, OrderStatusCancelled:
		return true
	default:
		return false
	}
}

func CanTransitionOrderStatus(from, to OrderStatus) bool {
	if from == to {
		return !from.IsTerminal()
	}
	switch from {
	case "":
		return to == OrderStatusPending || to == OrderStatusPendingPayment || to == OrderStatusActive
	case OrderStatusPending:
		return to == OrderStatusPendingPayment || to == OrderStatusActive || to == OrderStatusCancelled || to == OrderStatusRefunded
	case OrderStatusPendingPayment:
		return to == OrderStatusActive || to == OrderStatusCancelled || to == OrderStatusRefunded
	case OrderStatusActive:
		return to == OrderStatusCompleted || to == OrderStatusDisputed || to == OrderStatusCancelled || to == OrderStatusRefunded
	case OrderStatusDisputed:
		return to == OrderStatusCompleted || to == OrderStatusRefunded
	default:
		return false
	}
}

func ValidateOrderStatusTransition(from, to OrderStatus) error {
	if CanTransitionOrderStatus(from, to) {
		return nil
	}
	return fmt.Errorf("invalid order status transition: %s -> %s", from, to)
}

func (s ListingStatus) IsPurchasable() bool {
	return s == ListingStatusActive
}

func (s ListingStatus) IsTerminal() bool {
	return s == ListingStatusDeleted
}

func CanTransitionListingStatus(from, to ListingStatus) bool {
	if from == to {
		return !from.IsTerminal()
	}
	switch from {
	case "":
		return to == ListingStatusActive || to == ListingStatusPendingReview || to == ListingStatusPaused
	case ListingStatusPendingReview:
		return to == ListingStatusActive || to == ListingStatusDeleted
	case ListingStatusActive:
		return to == ListingStatusPaused || to == ListingStatusSoldOut || to == ListingStatusDeleted
	case ListingStatusPaused:
		return to == ListingStatusActive || to == ListingStatusDeleted
	case ListingStatusSoldOut:
		return to == ListingStatusActive || to == ListingStatusDeleted
	default:
		return false
	}
}

func ValidateListingStatusTransition(from, to ListingStatus) error {
	if CanTransitionListingStatus(from, to) {
		return nil
	}
	return fmt.Errorf("invalid listing status transition: %s -> %s", from, to)
}

func (s SessionStatus) IsTerminal() bool {
	return s == SessionTerminated
}

func CanTransitionSessionStatus(from, to SessionStatus) bool {
	if from == to {
		return !from.IsTerminal()
	}
	switch from {
	case "":
		return to == SessionActive
	case SessionActive:
		return to == SessionDisabled || to == SessionTerminated
	case SessionDisabled:
		return to == SessionActive || to == SessionTerminated
	default:
		return false
	}
}

func ValidateSessionStatusTransition(from, to SessionStatus) error {
	if CanTransitionSessionStatus(from, to) {
		return nil
	}
	return fmt.Errorf("invalid session status transition: %s -> %s", from, to)
}
