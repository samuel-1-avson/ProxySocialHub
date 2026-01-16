"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateProfile, type User } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";

function EditProfileContent() {
    const router = useRouter();
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
            } catch (err) {
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
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update profile");
        } finally {
            setSaving(false);
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

    return (
        <div className="min-h-screen" style={{ background: "var(--background)" }}>
            <Navbar />

            <main className="container py-8 max-w-xl">
                <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--foreground)" }}>
                    Edit Profile
                </h1>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Avatar */}
                    <div className="card">
                        <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>Profile Picture</h2>

                        <div className="flex items-center gap-6">
                            <div className="avatar-lg">
                                {form.avatar_url ? (
                                    <img src={form.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                                ) : (
                                    <span>{form.display_name?.charAt(0) || user?.email?.charAt(0) || "?"}</span>
                                )}
                            </div>
                            <div className="flex-1">
                                <input
                                    type="url"
                                    className="input mb-2"
                                    value={form.avatar_url}
                                    onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                                    placeholder="Image URL (e.g., https://...)"
                                />
                                <p className="text-xs" style={{ color: "var(--muted)" }}>
                                    Enter a URL to your profile picture
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Basic Info */}
                    <div className="card">
                        <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>Basic Information</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Display Name
                                </label>
                                <input
                                    type="text"
                                    className="input"
                                    value={form.display_name}
                                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                                    placeholder="Your display name"
                                    maxLength={100}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Username
                                </label>
                                <div className="flex items-center">
                                    <span className="px-3 py-2 rounded-l-lg border border-r-0" style={{ background: "var(--background)", borderColor: "var(--card-border)", color: "var(--muted)" }}>
                                        @
                                    </span>
                                    <input
                                        type="text"
                                        className="input rounded-l-none"
                                        value={form.username}
                                        onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                                        placeholder="username"
                                        maxLength={50}
                                    />
                                </div>
                                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                                    Letters, numbers, and underscores only
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Bio
                                </label>
                                <textarea
                                    className="input min-h-24"
                                    value={form.bio}
                                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                                    placeholder="Tell others about yourself..."
                                    maxLength={500}
                                />
                                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                                    {form.bio.length}/500 characters
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Contact */}
                    <div className="card">
                        <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>Contact & Links</h2>

                        <div className="space.y-4">
                            <div className="mb-4">
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Location
                                </label>
                                <input
                                    type="text"
                                    className="input"
                                    value={form.location}
                                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                                    placeholder="e.g., Accra, Ghana"
                                    maxLength={100}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
                                    Website
                                </label>
                                <input
                                    type="url"
                                    className="input"
                                    value={form.website}
                                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                                    placeholder="https://yourwebsite.com"
                                    maxLength={255}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Messages */}
                    {error && (
                        <div className="p-3 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--error)" }}>
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="p-3 rounded-lg" style={{ background: "rgba(34, 197, 94, 0.1)", color: "var(--success)" }}>
                            Profile updated successfully!
                        </div>
                    )}

                    {/* Submit */}
                    <div className="flex gap-4">
                        <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                            {saving ? "Saving..." : "Save Changes"}
                        </button>
                        <Link href="/profile" className="btn btn-secondary">
                            Cancel
                        </Link>
                    </div>
                </form>
            </main>
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
