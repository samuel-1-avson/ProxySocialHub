// ProxyHubb Fuzzing Tests
// Run with: cargo fuzz run escrow_fuzz

#![no_main]
use libfuzzer_sys::fuzz_target;
use anchor_lang::prelude::*;

// Fuzz target for escrow settlement calculations
fuzz_target!(|data: &[u8]| {
    if data.len() < 24 {
        return;
    }
    
    // Parse fuzz input
    let total_amount = u64::from_le_bytes([
        data[0], data[1], data[2], data[3],
        data[4], data[5], data[6], data[7],
    ]);
    
    let bandwidth_used = u64::from_le_bytes([
        data[8], data[9], data[10], data[11],
        data[12], data[13], data[14], data[15],
    ]);
    
    let bandwidth_limit = u64::from_le_bytes([
        data[16], data[17], data[18], data[19],
        data[20], data[21], data[22], data[23],
    ]);
    
    // Prevent division by zero
    if bandwidth_limit == 0 {
        return;
    }
    
    // Calculate proportional payout (same logic as program)
    let capped_usage = std::cmp::min(bandwidth_used, bandwidth_limit);
    
    // Check for overflow
    let seller_payout = match total_amount.checked_mul(capped_usage) {
        Some(product) => match product.checked_div(bandwidth_limit) {
            Some(result) => result,
            None => return, // Division would overflow
        },
        None => return, // Multiplication would overflow
    };
    
    let buyer_refund = total_amount.saturating_sub(seller_payout);
    
    // Invariants that should always hold
    assert!(seller_payout <= total_amount, "Seller payout exceeds total");
    assert!(buyer_refund <= total_amount, "Buyer refund exceeds total");
    assert!(seller_payout + buyer_refund <= total_amount, "Sum exceeds total");
    
    // If usage equals limit, seller gets everything
    if bandwidth_used >= bandwidth_limit {
        assert_eq!(seller_payout, total_amount, "Full usage should mean full payout");
        assert_eq!(buyer_refund, 0, "Full usage should mean no refund");
    }
    
    // If usage is 0, buyer gets everything
    if bandwidth_used == 0 {
        assert_eq!(seller_payout, 0, "Zero usage should mean no payout");
        assert_eq!(buyer_refund, total_amount, "Zero usage should mean full refund");
    }
});
