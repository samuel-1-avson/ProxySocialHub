/** Account entitlement from `trust_tier` (quotas / KYC). Not the identity `verified` flag. */
export function accountTierLabel(tier?: string | null): string {
    switch ((tier || 'new').toLowerCase()) {
        case 'premium':
            return 'Premium';
        case 'verified':
            return 'KYC';
        default:
            return 'Starter';
    }
}

export function identityStatusLabel(verified?: boolean | null): string {
    return verified ? 'Verified' : 'Unverified';
}
