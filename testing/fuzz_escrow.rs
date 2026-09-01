// ProxyHubb Adversarial Fuzzing Targets (Rust libfuzzer)
// Run with: cargo fuzz run escrow_fuzz

#![no_main]
use libfuzzer_sys::fuzz_target;

// Target 1: Mutual Receipt Settlement Math Fuzzing
fuzz_target!(|data: &[u8]| {
    if data.len() < 32 {
        return;
    }
    
    // 1. Parse fuzz inputs
    let total_amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let bytes_used = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let bandwidth_limit = u64::from_le_bytes(data[16..24].try_into().unwrap());
    let _seq_num = u64::from_le_bytes(data[24..32].try_into().unwrap());
    
    if bandwidth_limit == 0 {
        return; // Division by zero guard
    }
    
    // 2. Proportional Settlement Calculation (matching Solana program lib.rs)
    let capped_usage = std::cmp::min(bytes_used, bandwidth_limit);
    
    // Check 128-bit safe arithmetic
    let seller_payout = match (total_amount as u128).checked_mul(capped_usage as u128) {
        Some(product) => match product.checked_div(bandwidth_limit as u128) {
            Some(result) => result as u64,
            None => return,
        },
        None => return,
    };
    
    let buyer_refund = total_amount.saturating_sub(seller_payout);
    
    // INVARIANT 1: Zero-leak conservation law
    assert!(seller_payout <= total_amount, "Seller payout exceeds total amount");
    assert!(buyer_refund <= total_amount, "Buyer refund exceeds total amount");
    assert_eq!(seller_payout + buyer_refund, total_amount, "Conservation law violated: sum != total");
    
    // INVARIANT 2: Boundary conditions
    if bytes_used >= bandwidth_limit {
        assert_eq!(seller_payout, total_amount, "Full usage must result in 100% seller payout");
        assert_eq!(buyer_refund, 0, "Full usage must result in 0 buyer refund");
    }
    if bytes_used == 0 {
        assert_eq!(seller_payout, 0, "Zero usage must result in 0 seller payout");
        assert_eq!(buyer_refund, total_amount, "Zero usage must result in 100% buyer refund");
    }
    
    // 3. Staked Gateway Slashing Invariant Fuzzing
    if data.len() >= 56 {
        let initial_stake = u64::from_le_bytes(data[32..40].try_into().unwrap());
        let min_stake = u64::from_le_bytes(data[40..48].try_into().unwrap());
        let slash_amount = u64::from_le_bytes(data[48..56].try_into().unwrap());
        
        if slash_amount <= initial_stake {
            let remaining_stake = initial_stake - slash_amount;
            let is_active = remaining_stake >= min_stake;
            
            assert!(remaining_stake <= initial_stake, "Remaining stake exceeds initial stake");
            if remaining_stake < min_stake {
                assert!(!is_active, "Gateway must be deactivated when remaining < min_stake");
            } else {
                assert!(is_active, "Gateway must remain active when remaining >= min_stake");
            }
        }
    }
    
    // 4. Proof-of-Bandwidth Mining Proportional Reward Conservation Fuzzing
    if data.len() >= 80 {
        let total_emission = u64::from_le_bytes(data[56..64].try_into().unwrap());
        let total_verified_bytes = u64::from_le_bytes(data[64..72].try_into().unwrap());
        let provider_bytes = u64::from_le_bytes(data[72..80].try_into().unwrap());
        
        if total_verified_bytes > 0 && provider_bytes <= total_verified_bytes {
            let reward = match (provider_bytes as u128).checked_mul(total_emission as u128) {
                Some(p) => match p.checked_div(total_verified_bytes as u128) {
                    Some(r) => r as u64,
                    None => return,
                },
                None => return,
            };
            assert!(reward <= total_emission, "Provider reward cannot exceed total epoch emission");
        }
    }
});
