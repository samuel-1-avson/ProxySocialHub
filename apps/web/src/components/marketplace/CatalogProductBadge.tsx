'use client';

import type { CatalogProductSummary } from '@/lib/api/catalog';
import { catalogProductBadgeLabel } from '@/lib/listing-display';
import { Package } from 'lucide-react';

interface CatalogProductBadgeProps {
    product?: CatalogProductSummary | null;
    className?: string;
}

export function CatalogProductBadge({ product, className = '' }: CatalogProductBadgeProps) {
    const label = catalogProductBadgeLabel(product ?? undefined);
    if (!label || !product?.title) return null;

    return (
        <span
            data-testid="catalog-product-badge"
            title={product.title}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-widest bg-violet-500/10 border border-violet-500/25 text-violet-300 ${className}`}
        >
            <Package size={8} aria-hidden />
            {label}
        </span>
    );
}
