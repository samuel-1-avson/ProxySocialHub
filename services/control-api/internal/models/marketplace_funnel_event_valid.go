package models

// IsValidFunnelEventName returns true for marketplace.funnel.v1 event names.
func IsValidFunnelEventName(name string) bool {
	switch name {
	case FunnelListingView,
		FunnelListingSave,
		FunnelBuyModalOpen,
		FunnelOrderCreated,
		FunnelEscrowInitiated,
		FunnelEscrowConfirmed,
		FunnelCredentialsDelivered:
		return true
	default:
		return false
	}
}
