'use client';

import { useParams } from 'next/navigation';
import { MarketplaceOrderDetailView } from '@/components/marketplace/MarketplaceOrderDetailView';
import { ROUTES } from '@/lib/navigation/routes';

export default function MarketplaceOrderDetailPage() {
    const params = useParams<{ id: string }>();
    const orderId = params?.id ?? '';

    return (
        <MarketplaceOrderDetailView
            orderId={orderId}
            backHref={ROUTES.marketplaceOrders}
            backLabel="My orders"
        />
    );
}
