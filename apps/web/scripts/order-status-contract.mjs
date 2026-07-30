/**
 * Contract checks for order status helpers (Phase 3B-5).
 * Run: npm run test:order-status
 */

const ORDER_STATUSES = [
    'pending',
    'pending_payment',
    'active',
    'completed',
    'disputed',
    'refunded',
    'cancelled',
];

function orderStatusLabel(status) {
    const labels = {
        pending: 'Pending',
        pending_payment: 'Awaiting payment',
        active: 'Active',
        completed: 'Completed',
        disputed: 'Disputed',
        refunded: 'Refunded',
        cancelled: 'Cancelled',
    };
    return labels[status] || status.replace(/_/g, ' ');
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

assert(ORDER_STATUSES.length === 7, 'expected 7 statuses');
assert(orderStatusLabel('pending_payment') === 'Awaiting payment', 'pending_payment label');
assert(orderStatusLabel('refunded') === 'Refunded', 'refunded label');
assert(orderStatusLabel('weird_custom') === 'weird custom', 'unknown fallback');

console.log('order-status contract OK');
