"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { createListing } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";

function CreateListingContent() {
    const router = useRouter();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [form, setForm] = useState({
        title: "",
        description: "",
        proxy_type: "residential",
        protocol: "HTTP",
        price_per_gb: "",
        min_purchase_gb: "1",
        available_bandwidth_gb: "",
        max_concurrency: "5",
    });

    const [bulkDiscounts, setBulkDiscounts] = useState<{ min_gb: string; price_per_gb: string }[]>([]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // Validation
        if (!form.title.trim()) {
            setError("Title is required");
            return;
        }
        if (!form.price_per_gb || parseFloat(form.price_per_gb) <= 0) {
            setError("Valid price is required");
            return;
        }
        if (!form.available_bandwidth_gb || parseFloat(form.available_bandwidth_gb) <= 0) {
            setError("Available bandwidth is required");
            return;
        }

        setLoading(true);
        try {
            await createListing({
                title: form.title,
                description: form.description,
                proxy_type: form.proxy_type,
                protocol: form.protocol,
                price_per_gb: parseFloat(form.price_per_gb),
                min_purchase_gb: parseFloat(form.min_purchase_gb) || 1,
                available_bandwidth_gb: parseFloat(form.available_bandwidth_gb),
                max_concurrency: parseInt(form.max_concurrency) || 5,
            });

            router.push("/marketplace?created=true");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create listing");
        } finally {
            setLoading(false);
        }
    };

    const addBulkDiscount = () => {
        setBulkDiscounts([...bulkDiscounts, { min_gb: "", price_per_gb: "" }]);
    };

    const removeBulkDiscount = (index: number) => {
        setBulkDiscounts(bulkDiscounts.filter((_, i) => i !== index));
    };

    // Check if user is a provider
    if (user?.role !== "provider" && user?.role !== "admin") {
        return (
            <div className="min-h-screen" style={{ background: "var(--background)" }}>
                <Navbar />
                <div className="container py-20 text-center">
                    <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--foreground)" }}>
                        Provider Access Required
                    </h1>
                    <p className="mb-6" style={{ color: "var(--muted)" }}>
                        Only providers can create listings. Please register as a provider to sell proxy bandwidth.
                    </p>
                    <Link href="/register?role=provider" className="btn btn-primary">
                        Become a Provider
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />

            <main className="container py-8 max-w-2xl">
                <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--foreground)" }}>
                    Create New Listing
                </h1>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Basic Info */}
                    <div className="card">
                        <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>Basic Information</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Title *
                                </label>
                                <input
                                    type="text"
                                    className="input"
                                    value={form.title}
                                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                                    placeholder="e.g., Premium Accra Residential IPs"
                                    maxLength={200}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Description
                                </label>
                                <textarea
                                    className="input min-h-32"
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder="Describe your proxy service, use cases, features..."
                                    maxLength={2000}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                        Proxy Type *
                                    </label>
                                    <select
                                        className="input"
                                        value={form.proxy_type}
                                        onChange={(e) => setForm({ ...form, proxy_type: e.target.value })}
                                    >
                                        <option value="residential">Residential</option>
                                        <option value="mobile">Mobile</option>
                                        <option value="datacenter">Datacenter</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                        Protocol *
                                    </label>
                                    <select
                                        className="input"
                                        value={form.protocol}
                                        onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                                    >
                                        <option value="HTTP">HTTP</option>
                                        <option value="HTTPS">HTTPS</option>
                                        <option value="SOCKS5">SOCKS5</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Pricing */}
                    <div className="card">
                        <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>Pricing</h2>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                        Price per GB (₵) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        className="input"
                                        value={form.price_per_gb}
                                        onChange={(e) => setForm({ ...form, price_per_gb: e.target.value })}
                                        placeholder="0.45"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                        Minimum Purchase (GB)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        className="input"
                                        value={form.min_purchase_gb}
                                        onChange={(e) => setForm({ ...form, min_purchase_gb: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Bulk Discounts */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                                        Bulk Discounts
                                    </label>
                                    <button type="button" onClick={addBulkDiscount} className="btn btn-ghost text-sm py-1">
                                        + Add Discount
                                    </button>
                                </div>

                                {bulkDiscounts.map((discount, idx) => (
                                    <div key={idx} className="flex items-center gap-2 mb-2">
                                        <input
                                            type="number"
                                            min="1"
                                            className="input flex-1"
                                            placeholder="Min GB"
                                            value={discount.min_gb}
                                            onChange={(e) => {
                                                const updated = [...bulkDiscounts];
                                                updated[idx].min_gb = e.target.value;
                                                setBulkDiscounts(updated);
                                            }}
                                        />
                                        <span style={{ color: "var(--muted)" }}>→</span>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0.01"
                                            className="input flex-1"
                                            placeholder="₵ per GB"
                                            value={discount.price_per_gb}
                                            onChange={(e) => {
                                                const updated = [...bulkDiscounts];
                                                updated[idx].price_per_gb = e.target.value;
                                                setBulkDiscounts(updated);
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeBulkDiscount(idx)}
                                            className="btn btn-ghost text-sm py-1 px-2"
                                            style={{ color: "var(--error)" }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Availability */}
                    <div className="card">
                        <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>Availability</h2>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Available Bandwidth (GB) *
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    className="input"
                                    value={form.available_bandwidth_gb}
                                    onChange={(e) => setForm({ ...form, available_bandwidth_gb: e.target.value })}
                                    placeholder="100"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Max Concurrent Connections
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    className="input"
                                    value={form.max_concurrency}
                                    onChange={(e) => setForm({ ...form, max_concurrency: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--error)" }}>
                            {error}
                        </div>
                    )}

                    {/* Submit */}
                    <div className="flex gap-4">
                        <button type="submit" disabled={loading} className="btn btn-primary flex-1">
                            {loading ? "Creating..." : "Create Listing"}
                        </button>
                        <Link href="/marketplace" className="btn btn-secondary">
                            Cancel
                        </Link>
                    </div>
                </form>
            </main>
        </div>
    );
}

export default function CreateListingPage() {
    return (
        <ProtectedRoute requiredRole="provider">
            <CreateListingContent />
        </ProtectedRoute>
    );
}
