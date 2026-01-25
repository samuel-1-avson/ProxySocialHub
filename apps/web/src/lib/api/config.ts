/**
 * Config API Module
 * System-wide configuration and public parameters
 */

import { apiGet } from './client';

export interface SystemConfig {
    treasury_solana: string;
    [key: string]: any;
}

/**
 * Get public system configuration (Treasury addresses, etc.)
 */
export function getSystemConfig() {
    return apiGet<SystemConfig>('/v1/system/config/public');
}
