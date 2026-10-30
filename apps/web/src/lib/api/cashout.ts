import { apiGet, apiPost } from './client';

/** Mobile Money networks Paystack supports in Ghana (bank_code values). */
export const MOMO_NETWORKS = [
    { code: 'MTN', label: 'MTN Mobile Money' },
    { code: 'VOD', label: 'Telecel Cash' },
    { code: 'ATL', label: 'AirtelTigo Money' },
] as const;

export type MomoNetwork = (typeof MOMO_NETWORKS)[number]['code'];

export type CashoutStatus =
    | 'quoted'
    | 'confirmed'
    | 'sweeping'
    | 'swept'
    | 'transferring'
    | 'completed'
    | 'refunding'
    | 'refunded'
    | 'expired'
    | 'failed';

export interface CashoutDestination {
    network: MomoNetwork;
    phone_last4: string;
    name: string;
    ready_at: string;
}

export interface CashoutRecord {
    id: string;
    status: CashoutStatus;
    amount_minor: number;
    fee_minor: number;
    reference: string;
    created_at: string;
}

export interface CashoutOverview {
    destination?: CashoutDestination;
    spendable_sol?: number;
    spendable_ghs_estimate?: number;
    recent: CashoutRecord[];
    limits: {
        min_ghs: number;
        max_ghs: number;
        daily_ghs: number;
        flat_fee_ghs: number;
        used_today_ghs: number;
    };
}

export interface CashoutQuote {
    id: string;
    amount_ghs: number;
    fee_ghs: number;
    sol: number;
    network: MomoNetwork;
    phone_last4: string;
    expires_in: number;
}

export interface CashoutResult {
    id: string;
    status: CashoutStatus;
    amount_ghs: number;
    reference: string;
    message: string;
}

export function getCashoutOverview() {
    return apiGet<CashoutOverview>('/v1/wallet/cashout');
}

export function setCashoutDestination(body: { network: MomoNetwork; phone: string; account_name: string }) {
    return apiPost<CashoutDestination>('/v1/wallet/cashout/destination', body);
}

export function quoteCashout(amountGHS: number) {
    return apiPost<CashoutQuote>('/v1/wallet/cashout/quote', { amount_ghs: amountGHS });
}

/** Confirm with a fresh Google ID token (step-up) and start the cash-out. */
export function confirmCashout(id: string, googleCredential: string) {
    return apiPost<CashoutResult>(`/v1/wallet/cashout/${id}/confirm`, { google_credential: googleCredential });
}

export function getCashout(id: string) {
    return apiGet<CashoutResult>(`/v1/wallet/cashout/${id}`);
}

export const CASHOUT_DONE: CashoutStatus[] = ['completed', 'refunded', 'failed', 'expired'];
