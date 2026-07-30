/**
 * Config API Module
 * System-wide configuration and public parameters
 */

import { apiGet } from './client';

export interface SystemConfig {
    treasury_solana: string;
    treasury_configured?: boolean;
    sol_price_usd: number;
    large_withdraw_threshold_sol?: number;
    [key: string]: unknown;
}

/**
 * Get public system configuration (Treasury addresses, etc.)
 */
export function getSystemConfig() {
    return apiGet<SystemConfig>('/v1/system/config/public');
}
