package api

import "time"

// approxSlotDuration is Solana's nominal slot time used to convert wall-clock
// voting windows into end_slot offsets.
const approxSlotDuration = 400 * time.Millisecond

// governanceEndSlot returns an absolute end_slot = currentSlot + durationSlots.
// Passing a bare duration as end_slot (without adding currentSlot) makes the
// voting window already expired on public clusters.
func governanceEndSlot(currentSlot uint64, duration time.Duration) uint64 {
	if duration <= 0 {
		duration = approxSlotDuration
	}
	durationSlots := uint64(duration / approxSlotDuration)
	if durationSlots == 0 {
		durationSlots = 1
	}
	return currentSlot + durationSlots
}

// governanceFixedVotingPower is the on-chain weight until token/stake CPI exists.
const governanceFixedVotingPower uint64 = 1
