/** Canonical marketplace order statuses — keep in sync with Go `models.OrderStatus`. */

export const ORDER_STATUSES = [
    'pending',
    'pending_payment',
    'active',
    'completed',
    'disputed',
    'refunded',
    'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_STATUS_SET = new Set<string>(ORDER_STATUSES);

export function isOrderStatus(value: string): value is OrderStatus {
    return ORDER_STATUS_SET.has(value);
}

/** Short badge / list label for buyer UI. */
export function orderStatusLabel(status: string): string {
    switch (status as OrderStatus) {
        case 'pending':
            return 'Pending';
        case 'pending_payment':
            return 'Awaiting payment';
        case 'active':
            return 'Active';
        case 'completed':
            return 'Completed';
        case 'disputed':
            return 'Disputed';
        case 'refunded':
            return 'Refunded';
        case 'cancelled':
            return 'Cancelled';
        default:
            return status.replace(/_/g, ' ');
    }
}

/** One-line buyer/seller copy for detail surfaces. */
export function orderStatusDescription(status: string): string {
    switch (status as OrderStatus) {
        case 'pending':
            return 'Order created. Fund escrow to activate proxy access.';
        case 'pending_payment':
            return 'Escrow intent recorded. Waiting for on-chain payment confirmation.';
        case 'active':
            return 'Escrow confirmed. Provisioning proxy credentials…';
        case 'completed':
            return 'Order settled. Credentials may still be available for review.';
        case 'disputed':
            return 'A dispute is open. Funds stay locked until resolution.';
        case 'refunded':
            return 'Escrow was refunded to the buyer.';
        case 'cancelled':
            return 'Order cancelled before escrow completion.';
        default:
            return 'Unknown order status.';
    }
}

export function orderCredentialsEligible(status: string): boolean {
    return status === 'active' || status === 'completed';
}

export function orderCancelEligible(status: string): boolean {
    return status === 'pending' || status === 'pending_payment';
}
