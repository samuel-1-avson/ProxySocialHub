"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
    getNotificationPreferences,
    updateNotificationPreferences,
    type NotificationPreference,
} from "@/lib/notifications-api";
import { GlassCard } from "@/components/ui/glass-card";
import {
    Mail,
    Smartphone,
    Monitor,
    UserPlus,
    Package,
    Award,
    AlertTriangle,
    Loader2,
    Check,
    Info,
} from "lucide-react";

export function NotificationPreferencesPanel() {
    const { user } = useAuth();
    const [preferences, setPreferences] = useState<NotificationPreference | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void loadPreferences();
    }, []);

    const loadPreferences = async () => {
        try {
            setLoading(true);
            const prefs = await getNotificationPreferences();
            setPreferences(prefs);
        } catch (err) {
            setError("Failed to load preferences");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (
        category: "social" | "business" | "community" | "system",
        channel: "in_app" | "email" | "push",
    ) => {
        if (!preferences || saving) return;

        const key = `${category}_${channel}` as keyof NotificationPreference;
        const newValue = !preferences[key];

        setPreferences({ ...preferences, [key]: newValue });

        try {
            setSaving(true);
            await updateNotificationPreferences({ [key]: newValue });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch {
            setError("Failed to save preferences");
            setPreferences({ ...preferences, [key]: !newValue });
        } finally {
            setSaving(false);
        }
    };

    const handleDigestChange = async (field: string, value: string | number) => {
        if (!preferences || saving) return;

        setPreferences({ ...preferences, [field]: value });

        try {
            setSaving(true);
            await updateNotificationPreferences({ [field]: value });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch {
            setError("Failed to save preferences");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!preferences) {
        return (
            <div className="text-center py-20">
                <p className="text-muted-foreground">Failed to load notification preferences</p>
            </div>
        );
    }

    const categories = [
        {
            id: "social",
            label: "Social",
            description: "Follows, messages, mentions, and friend requests",
            icon: UserPlus,
            color: "text-blue-500",
            bgColor: "bg-blue-500/10",
            borderColor: "border-blue-500/20",
        },
        {
            id: "business",
            label: "Business",
            description: "Orders, payments, and listing activity",
            icon: Package,
            color: "text-amber-500",
            bgColor: "bg-amber-500/10",
            borderColor: "border-amber-500/20",
        },
        {
            id: "community",
            label: "Community",
            description: "Replies, upvotes, badges, and forum activity",
            icon: Award,
            color: "text-purple-500",
            bgColor: "bg-purple-500/10",
            borderColor: "border-purple-500/20",
        },
        {
            id: "system",
            label: "System",
            description: "Security alerts, maintenance, and account updates",
            icon: AlertTriangle,
            color: "text-red-500",
            bgColor: "bg-red-500/10",
            borderColor: "border-red-500/20",
        },
    ];

    const channels = [
        { id: "in_app", label: "In-App", icon: Monitor, description: "Show in notification center" },
        { id: "email", label: "Email", icon: Mail, description: "Send to your email address" },
        { id: "push", label: "Push", icon: Smartphone, description: "Mobile push notifications" },
    ];

    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-xl font-bold font-mono tracking-tight">Notifications</h2>
                    <p className="text-muted-foreground mt-1 text-sm">Choose how you want to be notified</p>
                </div>
                {saving && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-mono">Saving...</span>
                    </div>
                )}
                {saved && (
                    <div className="flex items-center gap-2 text-emerald-500">
                        <Check className="w-4 h-4" />
                        <span className="text-sm font-mono">Saved</span>
                    </div>
                )}
            </div>

            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm font-mono">
                    {error}
                </div>
            )}

            <div className="space-y-6">
                {categories.map((category) => (
                    <GlassCard key={category.id} className="!p-6">
                        <div className="flex items-start gap-4 mb-6">
                            <div
                                className={`w-12 h-12 rounded-xl ${category.bgColor} ${category.borderColor} border flex items-center justify-center`}
                            >
                                <category.icon className={`w-6 h-6 ${category.color}`} />
                            </div>
                            <div>
                                <h3 className="font-bold font-mono text-lg">{category.label}</h3>
                                <p className="text-sm text-muted-foreground">{category.description}</p>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-3 gap-4">
                            {channels.map((channel) => {
                                const prefKey = `${category.id}_${channel.id}` as keyof NotificationPreference;
                                const isEnabled = preferences[prefKey] as boolean;

                                return (
                                    <button
                                        key={channel.id}
                                        type="button"
                                        onClick={() =>
                                            handleToggle(
                                                category.id as "social" | "business" | "community" | "system",
                                                channel.id as "in_app" | "email" | "push",
                                            )
                                        }
                                        disabled={saving}
                                        className={`p-4 rounded-xl border text-left transition-all ${
                                            isEnabled
                                                ? `${category.bgColor} ${category.borderColor} border-2`
                                                : "bg-secondary/20 border-border hover:border-secondary"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <channel.icon
                                                className={`w-5 h-5 ${isEnabled ? category.color : "text-muted-foreground"}`}
                                            />
                                            <span
                                                className={`font-bold font-mono ${isEnabled ? "text-foreground" : "text-muted-foreground"}`}
                                            >
                                                {channel.label}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{channel.description}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </GlassCard>
                ))}
            </div>

            <GlassCard className="!p-6">
                <div className="flex items-start gap-4 mb-6">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Mail className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-bold font-mono text-lg">Email digest</h3>
                        <p className="text-sm text-muted-foreground">How often you receive email summaries</p>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-mono font-medium mb-2">Frequency</label>
                        <select
                            value={preferences.email_digest_frequency}
                            onChange={(e) => handleDigestChange("email_digest_frequency", e.target.value)}
                            disabled={saving}
                            className="w-full bg-secondary/20 border border-border rounded-lg px-4 py-2 text-sm font-mono focus:border-primary outline-none"
                        >
                            <option value="immediate">Immediate</option>
                            <option value="hourly">Hourly digest</option>
                            <option value="daily">Daily digest</option>
                        </select>
                    </div>

                    {preferences.email_digest_frequency === "daily" && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-mono font-medium mb-2">Day</label>
                                <select
                                    value={preferences.digest_day}
                                    onChange={(e) => handleDigestChange("digest_day", e.target.value)}
                                    disabled={saving}
                                    className="w-full bg-secondary/20 border border-border rounded-lg px-4 py-2 text-sm font-mono focus:border-primary outline-none"
                                >
                                    <option value="monday">Monday</option>
                                    <option value="tuesday">Tuesday</option>
                                    <option value="wednesday">Wednesday</option>
                                    <option value="thursday">Thursday</option>
                                    <option value="friday">Friday</option>
                                    <option value="saturday">Saturday</option>
                                    <option value="sunday">Sunday</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-mono font-medium mb-2">Time</label>
                                <select
                                    value={preferences.digest_hour}
                                    onChange={(e) => handleDigestChange("digest_hour", parseInt(e.target.value, 10))}
                                    disabled={saving}
                                    className="w-full bg-secondary/20 border border-border rounded-lg px-4 py-2 text-sm font-mono focus:border-primary outline-none"
                                >
                                    {Array.from({ length: 24 }, (_, i) => (
                                        <option key={i} value={i}>
                                            {i.toString().padStart(2, "0")}:00
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}
                </div>
            </GlassCard>

            <div className="flex items-start gap-3 p-4 bg-secondary/10 rounded-lg">
                <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                    <p className="mb-2 font-medium text-foreground">Delivery notes</p>
                    <ul className="space-y-1 list-disc list-inside">
                        <li>In-app notifications appear in your notification center</li>
                        <li>Email notifications are sent to {user?.email}</li>
                        <li>Push notifications require the mobile app</li>
                        <li>Some critical security notifications cannot be disabled</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
