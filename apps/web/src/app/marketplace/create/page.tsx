"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ArrowLeft, Save, Shield, Globe, Server, User } from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/auth";

export default function CreateListingPage() {
    const { user, isAuthenticated } = useAuth();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [formData, setFormData] = useState({
        title: "",
        description: "",
        proxy_type: "residential",
        protocol: "HTTP",
        rotation_type: "sticky",
        country: "US",
        isp: "",
        price_per_gb: 5,
        min_purchase_gb: 1,
        available_bandwidth_gb: 100,
        max_concurrency: 10
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name.includes("gb") || name.includes("users") || name === "price_per_gb" || name === "max_concurrency"
                ? parseFloat(value)
                : value
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
            const response = await fetchWithAuth(`${apiBase}/v1/listings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to create listing");
            }

            router.push("/marketplace");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    if (!user) return null; // Or redirect

    return (
        <div className="max-w-3xl mx-auto space-y-6 pb-20">
            {/* Header */}
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <Link href="/marketplace" className="btn-retro btn-retro-outline p-2">
                    <ArrowLeft size={16} />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold font-mono uppercase tracking-tight">Create Listing</h1>
                    <p className="text-muted-foreground font-mono text-xs">MONETIZE YOUR BANDWIDTH RESOURCES.</p>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono font-bold uppercase">
                    Error: {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
                {/* Section 1: Basic Info */}
                <div className="space-y-4">
                    <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2 border-b border-border/50 pb-2">
                        <User size={14} className="text-primary" /> Listing Details
                    </h3>

                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Title</label>
                            <input
                                name="title"
                                required
                                value={formData.title}
                                onChange={handleChange}
                                placeholder="e.g. Premium US Residential Proxy"
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Description</label>
                            <textarea
                                name="description"
                                required
                                value={formData.description}
                                onChange={handleChange}
                                rows={3}
                                placeholder="Describe your proxy quality, use cases, etc."
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            />
                        </div>
                    </div>
                </div>

                {/* Section 2: Technical Specs */}
                <div className="space-y-4">
                    <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2 border-b border-border/50 pb-2">
                        <Server size={14} className="text-primary" /> Technical Specs
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Proxy Type</label>
                            <select
                                name="proxy_type"
                                value={formData.proxy_type}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            >
                                <option value="residential">Residential</option>
                                <option value="mobile">Mobile (4G/5G)</option>
                                <option value="datacenter">Datacenter</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Protocol</label>
                            <select
                                name="protocol"
                                value={formData.protocol}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            >
                                <option value="HTTP">HTTP/HTTPS</option>
                                <option value="SOCKS5">SOCKS5</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Rotation</label>
                            <select
                                name="rotation_type"
                                value={formData.rotation_type}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            >
                                <option value="sticky">Sticky (Static IP)</option>
                                <option value="rotating">Rotating (Per Request)</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Max Concurrency</label>
                            <input
                                type="number"
                                name="max_concurrency"
                                value={formData.max_concurrency}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            />
                        </div>
                    </div>
                </div>

                {/* Section 3: Location & Pricing */}
                <div className="space-y-4">
                    <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2 border-b border-border/50 pb-2">
                        <Globe size={14} className="text-primary" /> Location & Pricing
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Country</label>
                            <select
                                name="country"
                                value={formData.country}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            >
                                <option value="US">United States</option>
                                <option value="GB">United Kingdom</option>
                                <option value="GH">Ghana</option>
                                <option value="DE">Germany</option>
                                <option value="NG">Nigeria</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">ISP (Optional)</label>
                            <input
                                name="isp"
                                value={formData.isp}
                                onChange={handleChange}
                                placeholder="e.g. AT&T, Vodafone"
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Price per GB (GHS)</label>
                            <input
                                type="number"
                                name="price_per_gb"
                                step="0.01"
                                value={formData.price_per_gb}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Available Bandwidth (GB)</label>
                            <input
                                type="number"
                                name="available_bandwidth_gb"
                                value={formData.available_bandwidth_gb}
                                onChange={handleChange}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            />
                        </div>
                    </div>
                </div>

                <div className="pt-4 flex justify-end">
                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-retro btn-retro-primary w-full md:w-auto px-8 py-3 flex items-center justify-center gap-2"
                    >
                        {loading ? "Creating..." : (
                            <>
                                <Save size={16} /> CREATE LISTING
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
