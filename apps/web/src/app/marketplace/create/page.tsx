"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth";
import { ArrowLeft, Save, Globe, Server, User } from "lucide-react";
import Link from "next/link";
import { getMyNodes, type NodeRegistration } from "@/lib/api/provider";
import {
    createListing,
    getListingProofPolicy,
    marketplaceKeys,
    signListingOfferDev,
    type CreateListingRequest,
    type ListingProofPolicy,
} from "@/lib/api/marketplace";
import { useQueryClient } from "@tanstack/react-query";
import {
    canonicalListingFields,
    signListingOfferProof,
} from "@/lib/proofs/listing-offer";

export default function CreateListingPage() {
    const { user, isAuthenticated } = useAuth();
    const { publicKey, signMessage, connected } = useWallet();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [providerNodes, setProviderNodes] = useState<NodeRegistration[]>([]);
    const [proofPolicy, setProofPolicy] = useState<ListingProofPolicy | null>(null);

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
        max_concurrency: 10,
        provider_node_id: "" as string,
    });

    useEffect(() => {
        if (!isAuthenticated) return;
        getMyNodes()
            .then(res => {
                const nodes = res.nodes ?? [];
                setProviderNodes(nodes);
                if (nodes.length === 1 && !formData.provider_node_id) {
                    setFormData(prev => ({ ...prev, provider_node_id: nodes[0].id }));
                }
            })
            .catch(() => setProviderNodes([]));
        getListingProofPolicy()
            .then(setProofPolicy)
            .catch(() => setProofPolicy(null));
    }, [isAuthenticated]);

    const proofRequired =
        proofPolicy?.required ??
        process.env.NEXT_PUBLIC_PROVIDER_SIGNATURE_MODE === "enforce";

    const selectedNode = providerNodes.find(n => n.id === formData.provider_node_id);

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
            const canon = canonicalListingFields(formData as CreateListingRequest);
            const payload: CreateListingRequest = {
                ...formData,
                description: canon.description,
                protocol: canon.protocol,
                rotation_type: canon.rotationType,
                max_concurrency: canon.maxConcurrency,
                min_purchase_gb: canon.minPurchaseGb,
                country: canon.country || formData.country,
                isp: canon.isp,
            };
            if (!payload.provider_node_id) {
                delete payload.provider_node_id;
            }

            const nodeId = payload.provider_node_id;
            const needsProof =
                proofRequired ||
                Boolean(nodeId && (selectedNode?.hotkey || proofRequired));

            if (needsProof) {
                if (!nodeId) {
                    throw new Error(
                        "Select a provider node to sign this listing, or register a node first."
                    );
                }
                const walletHotkey = connected && publicKey ? publicKey.toBase58() : "";
                const nodeHotkey = selectedNode?.hotkey?.trim() ?? "";
                const canWalletSign =
                    Boolean(connected && publicKey && signMessage) &&
                    (!nodeHotkey || nodeHotkey === walletHotkey);

                if (canWalletSign) {
                    payload.proof = await signListingOfferProof(
                        payload,
                        nodeId,
                        selectedNode?.gateway_node_id,
                        walletHotkey,
                        signMessage!
                    );
                } else if (proofPolicy?.dev_server_signing) {
                    const signed = await signListingOfferDev(payload);
                    payload.proof = signed.proof;
                } else if (proofRequired) {
                    if (!connected || !publicKey || !signMessage) {
                        throw new Error(
                            "Connect a Solana wallet to sign the listing offer, or enable dev server signing on control-api."
                        );
                    }
                    throw new Error(
                        "Your wallet does not match this node's provider hotkey. Use the provider wallet, enable dev server signing (PROXYHUB_PROVIDER_SIGNING_KEY), or use scripts/post-signed-listing-docker.ps1."
                    );
                }
            }

            const listing = await createListing(payload);
            queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
            if (listing.status === "pending_review") {
                router.push("/marketplace/manage?submitted=pending_review");
            } else {
                router.push("/marketplace");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    if (!user) return null;

    return (
        <div className="max-w-3xl mx-auto space-y-6 pb-20">
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <Link href="/marketplace" className="btn-retro btn-retro-outline p-2">
                    <ArrowLeft size={16} />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold font-mono uppercase tracking-tight">Create Listing</h1>
                    <p className="text-muted-foreground font-mono text-xs">MONETIZE YOUR BANDWIDTH RESOURCES.</p>
                </div>
            </div>

            {proofRequired && (
                <div className="p-4 bg-primary/10 border border-primary/20 text-xs font-mono">
                    <p className="font-bold uppercase text-primary mb-1">Signed listing required</p>
                    <p className="text-muted-foreground">
                        Provider signature mode is <span className="text-foreground">enforce</span>.
                        Select a provider node and sign with the matching wallet when you submit.
                        {proofPolicy?.dev_server_signing && (
                            <>
                                {" "}
                                Dev server signing is enabled — listings can be signed with the Docker
                                provider key when your browser wallet does not match the node hotkey.
                            </>
                        )}
                    </p>
                </div>
            )}

            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono font-bold uppercase">
                    Error: {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
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

                <div className="space-y-4">
                    <h3 className="text-sm font-bold font-mono uppercase flex items-center gap-2 border-b border-border/50 pb-2">
                        <Server size={14} className="text-primary" /> Technical Specs
                    </h3>

                    {providerNodes.length > 0 && (
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono font-bold uppercase">Provider node (for map placement)</label>
                            <select
                                name="provider_node_id"
                                value={formData.provider_node_id}
                                onChange={handleChange}
                                required={proofRequired}
                                className="w-full bg-secondary/10 border border-border p-2 text-sm font-mono rounded-sm focus:border-primary outline-none"
                            >
                                <option value="">{proofRequired ? "Select a node (required)" : "Auto-select best node"}</option>
                                {providerNodes.map(n => (
                                    <option key={n.id} value={n.id}>
                                        {n.name} ({n.status})
                                        {n.country ? ` — ${n.country}` : ""}
                                        {n.hotkey ? " · signed" : ""}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] text-muted-foreground font-mono">
                                Links this listing to infrastructure shown on the{" "}
                                <Link href="/marketplace/map" className="text-primary hover:underline">
                                    marketplace map
                                </Link>{" "}
                                (Google Maps).
                                {selectedNode?.hotkey && (
                                    <> Hotkey: {selectedNode.hotkey.slice(0, 8)}…</>
                                )}
                            </p>
                        </div>
                    )}

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
                            <label className="text-[10px] font-mono font-bold uppercase">Price per GB (USD)</label>
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
                                <Save size={16} /> {proofRequired ? "SIGN & CREATE LISTING" : "CREATE LISTING"}
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
