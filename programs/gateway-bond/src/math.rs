//! Slash math and challenge-window helpers (no Anchor).
//!
//! Session `slash_gateway` applied a percentage and transferred immediately.
//! Wave 8 splits **compute** from **permission**: these functions never move
//! lamports; the program refuses `resolve_slash` until `window_elapsed`.

pub const BPS_DENOM: u128 = 10_000;
pub const MIN_CHALLENGE_WINDOW_SECS: i64 = 3_600;
pub const MAX_SLASH_BPS: u16 = 10_000;

/// `stake * bps / 10_000`. `None` if bps is out of range.
pub fn slash_lamports(stake: u64, bps: u16) -> Option<u64> {
    if bps == 0 || bps > MAX_SLASH_BPS {
        return None;
    }
    let raw = (stake as u128)
        .checked_mul(bps as u128)?
        .checked_div(BPS_DENOM)?;
    Some(raw as u64)
}

pub fn window_elapsed(now: i64, resolve_after: i64) -> bool {
    now >= resolve_after
}

/// Operator may force-release if admin never resolves (2× window from open).
pub fn auto_release_at(opened_at: i64, challenge_window_secs: i64) -> Option<i64> {
    if challenge_window_secs < MIN_CHALLENGE_WINDOW_SECS {
        return None;
    }
    opened_at.checked_add(challenge_window_secs.checked_mul(2)?)
}

pub fn config_windows_ok(challenge_window_secs: i64, unbonding_secs: i64) -> bool {
    challenge_window_secs >= MIN_CHALLENGE_WINDOW_SECS
        && unbonding_secs >= challenge_window_secs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_stake_is_5000_bps() {
        assert_eq!(slash_lamports(1_000_000_000, 5_000), Some(500_000_000));
    }

    #[test]
    fn full_cap_is_10000_bps() {
        assert_eq!(slash_lamports(7, 10_000), Some(7));
    }

    #[test]
    fn zero_or_over_bps_rejected() {
        assert_eq!(slash_lamports(1_000, 0), None);
        assert_eq!(slash_lamports(1_000, 10_001), None);
    }

    #[test]
    fn floor_division_keeps_remainder_on_bond() {
        assert_eq!(slash_lamports(3, 1), Some(0));
    }

    #[test]
    fn large_stake_does_not_overflow() {
        let stake = u64::MAX;
        let got = slash_lamports(stake, 5_000).unwrap();
        assert_eq!(got, stake / 2);
    }

    #[test]
    fn window_not_elapsed_before_resolve_after() {
        assert!(!window_elapsed(100, 101));
        assert!(window_elapsed(101, 101));
        assert!(window_elapsed(200, 101));
    }

    #[test]
    fn min_window_rejects_instant_slash_config() {
        assert!(!config_windows_ok(0, 0));
        assert!(!config_windows_ok(3_599, 3_599));
        assert!(config_windows_ok(3_600, 3_600));
        assert!(!config_windows_ok(3_600, 3_599));
        assert!(config_windows_ok(86_400, 172_800));
    }

    #[test]
    fn auto_release_is_double_window() {
        assert_eq!(auto_release_at(1_000, 3_600), Some(8_200));
        assert_eq!(auto_release_at(1_000, 3_599), None);
    }
}
