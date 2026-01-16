"use client";

import { useState, useEffect } from "react";

import Link from "next/link";
import { Star, ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getListing, saveListing, unsaveListing, createOrder, getListingReviews, type Listing, type Review } from "@/lib/social-api";
import { Navbar } from "@/components/Navbar";

export default function ListingDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { isAuthenticated, user } = useAuth();

    const [listing, setListing] = useState<Listing | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isSaved, setIsSaved] = useState(false);

    // Purchase form
    const [quantity, setQuantity] = useState(10);
    const [purchasing, setPurchasing] = useState(false);
    const [purchaseError, setPurchaseError] = useState("");
    const [purchaseSuccess, setPurchaseSuccess] = useState(false);

    useEffect(() => {
        async function fetchData() {
            if (!params.id) return;

            setLoading(true);
            try {
                const data = await getListing(params.id as string);
                setListing(data.listing);
                setIsSaved(data.is_saved);
                setQuantity(data.listing.min_purchase_gb || 5);

                // Fetch reviews
                try {
                    const reviewsData = await getListingReviews(params.id as string);
                    setReviews(reviewsData.reviews || []);
                } catch {
                    // Reviews are optional
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load listing");
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [params.id]);

    // Calculate price with bulk discounts
    const calculatePrice = (gb: number): number => {
        if (!listing) return 0;
        let pricePerGb = listing.price_per_gb;
        const discounts = listing.bulk_discounts || [];
        for (const discount of discounts.sort((a, b) => b.min_gb - a.min_gb)) {
            if (gb >= discount.min_gb) {
                pricePerGb = discount.price_per_gb;
                break;
            }
        }
        return pricePerGb * gb;
    };

    const totalPrice = calculatePrice(quantity);
    const effectivePricePerGb = listing ? totalPrice / quantity : 0;

    const handleSave = async () => {
        if (!listing || !isAuthenticated) {
            router.push(`/login?redirect=/marketplace/${listing?.id}`);
            return;
        }

        try {
            if (isSaved) {
                await unsaveListing(listing.id);
            } else {
                await saveListing(listing.id);
            }
            setIsSaved(!isSaved);
        } catch (err) {
            // Ignore error, optimistic update
        }
    };

    const handlePurchase = async () => {
        if (!listing) return;

        if (!isAuthenticated) {
            router.push(`/login?redirect=/marketplace/${listing.id}`);
            return;
        }

        if (quantity < listing.min_purchase_gb) {
            setPurchaseError(`Minimum purchase is ${listing.min_purchase_gb} GB`);
            return;
        }
        if (quantity > listing.available_bandwidth_gb) {
            setPurchaseError("Not enough bandwidth available");
            return;
        }

        setPurchasing(true);
        setPurchaseError("");

        try {
            await createOrder(listing.id, quantity);
            setPurchaseSuccess(true);
            // Redirect after short delay
            setTimeout(() => {
                router.push("/dashboard/sessions?success=true");
            }, 2000);
        } catch (err) {
            setPurchaseError(err instanceof Error ? err.message : "Purchase failed");
        } finally {
            setPurchasing(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="flex items-center justify-center py-20">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    if (error || !listing) {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="container py-20 text-center">
                    <p style={{ color: "var(--error)" }}>{error || "Listing not found"}</p>
                    <Link href="/marketplace" className="btn btn-secondary mt-4">
                        Back to Marketplace
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />

            <main className="container py-8">
                {/* Breadcrumb */}
                <div className="mb-6">
                    <Link href="/marketplace" className="text-sm hover:underline flex items-center" style={{ color: "var(--muted)" }}>
                        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Marketplace
                    </Link>
                </div>

                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Title & Seller */}
                        <div>
                            <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--foreground)" }}>
                                {listing.title}
                            </h1>

                            {/* Seller Card */}
                            <Link href={`/profile/${listing.seller?.username || listing.seller_id}`} className="card flex items-center gap-4 p-4">
                                <div className="avatar">
                                    <span>{listing.seller?.display_name?.charAt(0) || "?"}</span>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                            @{listing.seller?.username || "unknown"}
                                        </span>
                                        {listing.seller?.verified && (
                                            <svg className="w-4 h-4" style={{ color: "var(--primary)" }} fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </div>
                                    <div className="text-sm flex items-center gap-3" style={{ color: "var(--muted)" }}>
                                        <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500 fill-current" /> {listing.seller?.avg_rating?.toFixed(1) || "5.0"}</span>
                                        <span>{listing.seller?.reviews_count || 0} reviews</span>
                                        <span>{listing.seller?.total_bandwidth_sold?.toLocaleString() || 0} GB sold</span>
                                    </div>
                                </div>
                            </Link>
                        </div>

                        {/* Stats */}
                        <div className="card grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div>
                                <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>{listing.proxy_type}</div>
                                <div className="text-sm" style={{ color: "var(--muted)" }}>Type</div>
                            </div>
                            <div>
                                <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>{listing.avg_latency_ms || "N/A"}ms</div>
                                <div className="text-sm" style={{ color: "var(--muted)" }}>Latency</div>
                            </div>
                            <div>
                                <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>{listing.uptime_percent || 99}%</div>
                                <div className="text-sm" style={{ color: "var(--muted)" }}>Uptime</div>
                            </div>
                            <div>
                                <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>{listing.success_rate || 99}%</div>
                                <div className="text-sm" style={{ color: "var(--muted)" }}>Success</div>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="card">
                            <h2 className="font-semibold mb-3" style={{ color: "var(--foreground)" }}>Description</h2>
                            <div className="whitespace-pre-line" style={{ color: "var(--muted)" }}>
                                {listing.description || "No description provided."}
                            </div>
                        </div>

                        {/* Reviews */}
                        {reviews.length > 0 && (
                            <div className="card">
                                <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>
                                    Reviews ({reviews.length})
                                </h2>

                                <div className="space-y-4">
                                    {reviews.map((review) => (
                                        <div key={review.id} className="border-t pt-4" style={{ borderColor: "var(--card-border)" }}>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                                        {review.reviewer?.display_name || review.reviewer?.username || "Anonymous"}
                                                    </span>
                                                    {review.verified_purchase && (
                                                        <span className="badge badge-success text-xs">Verified</span>
                                                    )}
                                                </div>
                                                <span className="text-sm" style={{ color: "var(--muted)" }}>
                                                    {new Date(review.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <div className="flex mb-1">
                                                {Array.from({ length: 5 }).map((_, i) => (
                                                    <Star
                                                        key={i}
                                                        className={`w-3 h-3 ${i < review.rating ? "text-yellow-500 fill-current" : "text-gray-300"}`}
                                                    />
                                                ))}
                                            </div>
                                            {review.title && (
                                                <h4 className="font-medium mb-1" style={{ color: "var(--foreground)" }}>{review.title}</h4>
                                            )}
                                            <p style={{ color: "var(--muted)" }}>{review.content}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar - Purchase Card */}
                    <div className="lg:col-span-1">
                        <div className="card sticky top-24">
                            {/* Success Message */}
                            {purchaseSuccess && (
                                <div className="mb-4 p-4 rounded-lg text-center" style={{ background: "rgba(34, 197, 94, 0.1)", color: "var(--success)" }}>
                                    <p className="font-semibold">Purchase Successful!</p>
                                    <p className="text-sm">Redirecting to your sessions...</p>
                                </div>
                            )}

                            {/* Price */}
                            <div className="text-center mb-6">
                                <div className="flex items-baseline justify-center gap-1">
                                    <span className="text-3xl font-bold" style={{ color: "var(--primary)" }}>
                                        ₵{listing.price_per_gb}
                                    </span>
                                    <span style={{ color: "var(--muted)" }}>/GB</span>
                                </div>
                                <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
                                    {listing.available_bandwidth_gb} GB available
                                </p>
                            </div>

                            {/* Bulk Discounts */}
                            {listing.bulk_discounts && listing.bulk_discounts.length > 0 && (
                                <div className="mb-6 p-3 rounded-lg" style={{ background: "rgba(249, 115, 22, 0.05)" }}>
                                    <p className="text-sm font-medium mb-2" style={{ color: "var(--foreground)" }}>
                                        Bulk Discounts:
                                    </p>
                                    <div className="space-y-1 text-sm" style={{ color: "var(--muted)" }}>
                                        {listing.bulk_discounts.map((d, i) => (
                                            <div key={i} className="flex justify-between">
                                                <span>{d.min_gb}+ GB</span>
                                                <span style={{ color: "var(--primary)" }}>₵{d.price_per_gb}/GB</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Quantity Input */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium mb-2" style={{ color: "var(--foreground)" }}>
                                    Bandwidth (GB)
                                </label>
                                <input
                                    type="number"
                                    className="input text-center text-lg"
                                    value={quantity}
                                    onChange={(e) => setQuantity(Math.max(listing.min_purchase_gb || 1, parseInt(e.target.value) || 0))}
                                    min={listing.min_purchase_gb || 1}
                                    max={listing.available_bandwidth_gb}
                                    disabled={purchaseSuccess}
                                />
                                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                                    Min: {listing.min_purchase_gb || 1} GB | Max: {listing.available_bandwidth_gb} GB
                                </p>
                            </div>

                            {/* Total */}
                            <div className="flex justify-between items-center mb-4 py-3 border-y" style={{ borderColor: "var(--card-border)" }}>
                                <span style={{ color: "var(--muted)" }}>Total:</span>
                                <div className="text-right">
                                    <span className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                                        ₵{totalPrice.toFixed(2)}
                                    </span>
                                    {effectivePricePerGb < listing.price_per_gb && (
                                        <p className="text-xs" style={{ color: "var(--success)" }}>
                                            You save ₵{((listing.price_per_gb - effectivePricePerGb) * quantity).toFixed(2)}!
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Error */}
                            {purchaseError && (
                                <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--error)" }}>
                                    {purchaseError}
                                </div>
                            )}

                            {/* Buttons */}
                            {!purchaseSuccess && (
                                <>
                                    <button
                                        onClick={handlePurchase}
                                        disabled={purchasing || listing.seller_id === user?.id}
                                        className="btn btn-primary w-full mb-3"
                                    >
                                        {purchasing ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <span className="spinner" style={{ width: 16, height: 16 }}></span>
                                                Processing...
                                            </span>
                                        ) : listing.seller_id === user?.id ? (
                                            "Your Listing"
                                        ) : (
                                            "Buy Now"
                                        )}
                                    </button>

                                    <button
                                        onClick={handleSave}
                                        className="btn btn-secondary w-full"
                                    >
                                        {isSaved ? <span className="flex items-center justify-center gap-2"><Star className="w-4 h-4 fill-current" /> Saved</span> : <span className="flex items-center justify-center gap-2"><Star className="w-4 h-4" /> Save for Later</span>}
                                    </button>

                                    {/* Contact Seller */}
                                    {listing.seller_id !== user?.id && (
                                        <Link href={`/messages?to=${listing.seller_id}`} className="btn btn-ghost w-full mt-3">
                                            Message Seller
                                        </Link>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
