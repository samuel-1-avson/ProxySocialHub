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
            className={`ui-tag ${className}`}
        >
            <Package size={8} aria-hidden />
            {label}
        </span>
    );
}
