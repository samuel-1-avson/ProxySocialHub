'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/navigation/routes';

/** Legacy path — redirects to canonical `/marketplace/orders/:id`. */
export default function DashboardOrderCredentialsRedirect() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const orderId = params?.id ?? '';

    useEffect(() => {
        if (!orderId) return;
        router.replace(ROUTES.marketplaceOrder(orderId));
    }, [orderId, router]);

    return (
        <div className="flex min-h-[40vh] items-center justify-center text-xs font-mono text-muted-foreground">
            Redirecting to order…
        </div>
    );
}
