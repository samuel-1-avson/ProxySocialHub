"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateProfile, type User } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { User as UserIcon, Camera, Save, X, Globe, MapPin, AtSign, Info, ChevronRight, LayoutGrid, Shield, ArrowLeft } from "lucide-react";

function EditProfileContent() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    const [form, setForm] = useState({
        display_name: "",
        username: "",
        bio: "",
        location: "",
        website: "",
        avatar_url: "",
    });

    useEffect(() => {
        async function loadProfile() {
            try {
                const profile = await getMyProfile();
                setForm({
                    display_name: profile.display_name || "",
                    username: profile.username || "",
                    bio: profile.bio || "",
                    location: profile.location || "",
                    website: profile.website || "",
                    avatar_url: profile.avatar_url || "",
                });
            } catch {
                setError("Failed to load profile");
            } finally {
                setLoading(false);
            }
        }
        loadProfile();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess(false);

        // Validation
        if (form.username && !/^[a-zA-Z0-9_]+$/.test(form.username)) {
            setError("Username can only contain letters, numbers, and underscores");
            return;
        }
        if (form.username && form.username.length < 3) {
            setError("Username must be at least 3 characters");
            return;
        }
        if (form.website && !form.website.startsWith("http")) {
            setError("Website must start with http:// or https://");
            return;
        }

        setSaving(true);
        try {
            await updateProfile(form as Partial<User>);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 5000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update profile");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                <p className="text-muted-foreground font-medium animate-pulse">Accessing secure profile storage...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-10 pb-20 relative">
            {/* Ambient Background Elements */}
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-40 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative">
                <div className="space-y-1">
                    <Link href="/profile" className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-widest mb-2 hover:translate-x-1 transition-transform">
                        <ArrowLeft size={14} />
                        Back to Identity
                    </Link>
                    <h1 className="text-4xl font-black text-white tracking-tighter">Edit Protocol Identity</h1>
                    <p className="text-muted-foreground text-sm">Update your public signature and global presence on the grid.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Link href="/profile" className="p-3 rounded-2xl bg-white/[0.05] border border-white/10 text-white hover:bg-white/[0.1] transition-all">
                        <X size={20} />
                    </Link>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="relative grid grid-cols-1 lg:grid-cols-3 gap-10">
                {/* Profile Sidebar Info */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="p-8 rounded-[2.5rem] bg-white/[0.03] backdrop-blur-3xl border border-white/5 space-y-8 text-center shadow-2xl">
                        <div className="relative group mx-auto w-fit">
                            <div className="absolute inset-0 bg-primary/20 rounded-[3rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                            <div className="relative w-40 h-40 rounded-[3rem] bg-black/40 border-2 border-white/10 flex items-center justify-center text-5xl font-black text-white/10 overflow-hidden shadow-2xl">
                                {form.avatar_url ? (
                                    <img src={form.avatar_url} alt="Avatar" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                ) : (
                                    <span>{(form.display_name?.[0] || user?.email?.[0] || "?").toUpperCase()}</span>
                                )}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                                    <Camera className="text-white animate-bounce-subtle" size={32} />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-white tracking-tight">{form.display_name || "Protocol Anonymous"}</h3>
                            <p className="text-xs text-primary font-bold uppercase tracking-widest">@{form.username || "unset_id"}</p>
                        </div>

                        <div className="pt-6 border-t border-white/5 space-y-4">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50 px-2">
                                <span>Security Level</span>
                                <span className="text-primary">Standard</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full w-2/3 bg-primary/40 rounded-full"></div>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 rounded-3xl bg-primary/5 border border-primary/10 space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                            <Shield size={16} />
                            <span className="text-xs font-black uppercase tracking-widest">Verified Badge</span>
                        </div>
                        <p className="text-[11px] text-primary/60 leading-relaxed font-medium">Verify your identity nodes to receive a blue mark and increase your trust score across all circuits.</p>
                        <button type="button" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">Apply for verification</button>
                    </div>
                </div>

                {/* Main Form Fields */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="p-8 rounded-[2.5rem] bg-white/[0.03] backdrop-blur-3xl border border-white/5 space-y-8 shadow-2xl">
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 pb-2 border-b border-white/5">
                                <LayoutGrid size={18} className="text-primary" />
                                <h2 className="text-lg font-bold text-white tracking-tight">Core Protocol Fields</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Display Name</label>
                                    <input
                                        type="text"
                                        className="w-full bg-white/[0.05] border border-white/5 rounded-2xl py-4 px-5 text-sm font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all placeholder:text-white/10"
                                        value={form.display_name}
                                        onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                                        placeholder="Human operator name"
                                        maxLength={100}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Protocol Handle</label>
                                    <div className="relative group">
                                        <AtSign className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-primary transition-colors" size={16} />
                                        <input
                                            type="text"
                                            className="w-full bg-white/[0.05] border border-white/5 rounded-2xl py-4 pl-12 pr-5 text-sm font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all placeholder:text-white/10"
                                            value={form.username}
                                            onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                                            placeholder="id_signature"
                                            maxLength={50}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Avatar Source URL</label>
                                <div className="relative group">
                                    <Globe className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-primary transition-colors" size={16} />
                                    <input
                                        type="url"
                                        className="w-full bg-white/[0.05] border border-white/5 rounded-2xl py-4 pl-12 pr-5 text-sm font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all placeholder:text-white/10"
                                        value={form.avatar_url}
                                        onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                                        placeholder="https://content.proxy/avatar.jpg"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-1">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Identity Bio / Payload</label>
                                    <span className="text-[10px] font-black text-muted-foreground opacity-50 tracking-widest">{form.bio.length} / 500</span>
                                </div>
                                <textarea
                                    className="w-full bg-white/[0.05] border border-white/5 rounded-3xl py-4 px-5 text-sm font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all min-h-[160px] resize-none placeholder:text-white/10 leading-relaxed"
                                    value={form.bio}
                                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                                    placeholder="Brief protocol description or mission statement..."
                                    maxLength={500}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">Geographic Origin</label>
                                    <div className="relative group">
                                        <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-primary transition-colors" size={16} />
                                        <input
                                            type="text"
                                            className="w-full bg-white/[0.05] border border-white/5 rounded-2xl py-4 pl-12 pr-5 text-sm font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all placeholder:text-white/10"
                                            value={form.location}
                                            onChange={(e) => setForm({ ...form, location: e.target.value })}
                                            placeholder="London Node, Earth"
                                            maxLength={100}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground ml-1">External Intelligence URL</label>
                                    <div className="relative group">
                                        <Globe className="absolute left-5 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-primary transition-colors" size={16} />
                                        <input
                                            type="url"
                                            className="w-full bg-white/[0.05] border border-white/5 rounded-2xl py-4 pl-12 pr-5 text-sm font-medium text-white focus:border-primary/50 focus:bg-white/[0.08] outline-none transition-all placeholder:text-white/10"
                                            value={form.website}
                                            onChange={(e) => setForm({ ...form, website: e.target.value })}
                                            placeholder="https://..."
                                            maxLength={255}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Status Messages */}
                        <div className="space-y-4">
                            {error && (
                                <div className="p-5 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                                    <Info size={20} />
                                    {error}
                                </div>
                            )}

                            {success && (
                                <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                                    <UserIcon size={20} />
                                    Identity transmission successful. Changes propagated.
                                </div>
                            )}
                        </div>

                        {/* Submit Actions */}
                        <div className="flex flex-col sm:flex-row gap-4 pt-4">
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-black shadow-xl shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-1 active:scale-95 transition-all disabled:opacity-50 group"
                            >
                                <Save size={18} className="group-hover:rotate-12 transition-transform" />
                                {saving ? "Syncing Identity..." : "Persist Identity Changes"}
                            </button>
                            <Link
                                href="/profile"
                                className="px-8 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-white text-sm font-bold hover:bg-white/[0.1] text-center transition-all active:scale-95"
                            >
                                Discard
                            </Link>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default function EditProfilePage() {
    return (
        <ProtectedRoute>
            <EditProfileContent />
        </ProtectedRoute>
    );
}
