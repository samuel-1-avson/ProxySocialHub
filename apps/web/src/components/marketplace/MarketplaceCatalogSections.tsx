"use client";

import { ShieldCheck, Sparkles, Star } from "lucide-react";
import type {
    FacetBucket,
    Listing,
    ListingCollectionSummary,
} from "@/lib/api/marketplace";
import { ListingCard } from "@/components/ListingCard";

type MarketplaceCatalogSectionsProps = {
    featured: Listing[];
    collections: ListingCollectionSummary[];
    countries: FacetBucket[];
    proxyTypes: FacetBucket[];
    activeCountry: string;
    activeProxyType: string;
    activeCollection: string | null;
    onCountrySelect: (country: string) => void;
    onProxyTypeSelect: (proxyType: string) => void;
    onCollectionSelect: (slug: string | null) => void;
    onListingSelect: (listing: Listing) => void;
};

export function MarketplaceCatalogSections({
    featured,
    collections,
    countries,
    proxyTypes,
    activeCountry,
    activeProxyType,
    activeCollection,
    onCountrySelect,
    onProxyTypeSelect,
    onCollectionSelect,
    onListingSelect,
}: MarketplaceCatalogSectionsProps) {
    const topCountries = countries.slice(0, 8);

    return (
        <div className="space-y-10">
            {collections.length > 0 && (
                <section className="space-y-4" data-testid="marketplace-collection-rails">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/50">
                            Curated sectors
                        </h2>
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
                        <button
                            type="button"
                            onClick={() => onCollectionSelect(null)}
                            className={`shrink-0 px-6 py-4 rounded-2xl border text-left transition-all ${
                                activeCollection === null
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/20"
                            }`}
                        >
                            <div className="text-[10px] font-black uppercase tracking-widest">All listings</div>
                            <div className="text-[9px] mt-1 opacity-60">Browse full grid</div>
                        </button>
                        {collections.map((collection) => (
                            <button
                                key={collection.slug}
                                type="button"
                                data-testid={`marketplace-collection-${collection.slug}`}
                                onClick={() => onCollectionSelect(collection.slug)}
                                className={`shrink-0 min-w-[200px] px-6 py-4 rounded-2xl border text-left transition-all ${
                                    activeCollection === collection.slug
                                        ? "border-primary/40 bg-primary/10 text-primary"
                                        : "border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/20"
                                }`}
                            >
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                    {collection.slug === "verified" && <ShieldCheck size={12} />}
                                    {collection.slug === "featured" && <Star size={12} />}
                                    {collection.slug === "editors-pick" && <Sparkles size={12} />}
                                    {collection.title}
                                </div>
                                <div className="text-[9px] mt-2 opacity-60 line-clamp-2">{collection.description}</div>
                                <div className="text-[9px] mt-2 font-mono text-primary/80">{collection.count} units</div>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {featured.length > 0 && activeCollection === null && (
                <section className="space-y-4" data-testid="marketplace-featured-strip">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/50">
                            Featured nodes
                        </h2>
                    </div>
                    <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-thin">
                        {featured.map((listing) => (
                            <div key={listing.id} className="shrink-0 w-[320px]">
                                <ListingCard listing={listing} onSelect={onListingSelect} />
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {(topCountries.length > 0 || proxyTypes.length > 0) && activeCollection === null && (
                <section className="space-y-4" data-testid="marketplace-facet-chips">
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/50">
                        Quick filters
                    </h2>
                    {proxyTypes.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {proxyTypes.map((bucket) => (
                                <button
                                    key={bucket.value}
                                    type="button"
                                    data-testid={`marketplace-facet-type-${bucket.value}`}
                                    onClick={() =>
                                        onProxyTypeSelect(
                                            activeProxyType === bucket.value ? "" : bucket.value,
                                        )
                                    }
                                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                                        activeProxyType === bucket.value
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-white/10 bg-white/[0.02] text-muted-foreground/60 hover:text-foreground"
                                    }`}
                                >
                                    {bucket.value}{" "}
                                    <span className="opacity-50 font-mono">({bucket.count})</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {topCountries.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {topCountries.map((bucket) => (
                                <button
                                    key={bucket.value}
                                    type="button"
                                    data-testid={`marketplace-facet-country-${bucket.value}`}
                                    onClick={() =>
                                        onCountrySelect(
                                            activeCountry === bucket.value ? "" : bucket.value,
                                        )
                                    }
                                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                                        activeCountry === bucket.value
                                            ? "border-primary/40 bg-primary/10 text-primary"
                                            : "border-white/10 bg-white/[0.02] text-muted-foreground/60 hover:text-foreground"
                                    }`}
                                >
                                    {bucket.value}{" "}
                                    <span className="opacity-50 font-mono">({bucket.count})</span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
