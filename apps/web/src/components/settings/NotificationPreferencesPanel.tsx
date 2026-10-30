"use client";

import { useState, useEffect } from "react";
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
            color: "text-info",
            bgColor: "bg-info/10",
            borderColor: "border-info/20",
        },
        {
            id: "business",
            label: "Business",
            description: "Orders, payments, and listing activity",
            icon: Package,
            color: "text-warning",
            bgColor: "bg-warning/10",
            borderColor: "border-warning/20",
        },
        {
            id: "community",
            label: "Community",
            description: "Replies, upvotes, badges, and forum activity",
            icon: Award,
            color: "text-primary",
            bgColor: "bg-primary/10",
            borderColor: "border-primary/20",
        },
        {
            id: "system",
            label: "System",
            description: "Security alerts, maintenance, and account updates",
            icon: AlertTriangle,
            color: "text-destructive",
            bgColor: "bg-destructive/10",
            borderColor: "border-destructive/20",
        },
    ];

    const channels = [
        { id: "in_app", label: "In-App", icon: Monitor, description: "Show in notification center", live: true },
        { id: "email", label: "Email", icon: Mail, description: "Coming soon: not delivered yet", live: false },
        { id: "push", label: "Push", icon: Smartphone, description: "Coming soon: not delivered yet", live: false },
    ];

    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-xl font-bold font-mono tracking-tight">Notifications</h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                        In-app delivery is live. Email and push preferences are saved for later. They are not delivered yet.
                    </p>
                </div>
                {saving && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-mono">Saving...</span>
                    </div>
                )}
                {saved && (
                    <div className="flex items-center gap-2 text-success">
                        <Check className="w-4 h-4" />
                        <span className="text-sm font-mono">Saved</span>
                    </div>
                )}
            </div>

            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-mono">
                    {error}
                </div>
            )}

            <div className="space-y-6">
                {categories.map((category) => (
                    <GlassCard key={category.id} className="!p-6">
                        <div className="flex items-start gap-4 mb-6">
                            <div
                                className={`w-12 h-12 rounded-lg ${category.bgColor} ${category.borderColor} border flex items-center justify-center`}
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
                                const interactive = channel.live;

                                return (
                                    <button
                                        key={channel.id}
                                        type="button"
                                        onClick={() => {
                                            if (!interactive) return;
                                            handleToggle(
                                                category.id as "social" | "business" | "community" | "system",
                                                channel.id as "in_app" | "email" | "push",
                                            );
                                        }}
                                        disabled={saving || !interactive}
                                        title={interactive ? undefined : "Coming soon"}
                                        className={`p-4 rounded-lg border text-left transition-all ${
                                            !interactive
                                                ? "bg-secondary/10 border-border opacity-70 cursor-not-allowed"
                                                : isEnabled
                                                ? `${category.bgColor} ${category.borderColor} border-2`
                                                : "bg-secondary/20 border-border hover:border-secondary"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <channel.icon
                                                className={`w-5 h-5 ${isEnabled && interactive ? category.color : "text-muted-foreground"}`}
                                            />
                                            <span
                                                className={`font-bold font-mono ${isEnabled && interactive ? "text-foreground" : "text-muted-foreground"}`}
                                            >
                                                {channel.label}
                                                {!interactive ? " (soon)" : ""}
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
                    <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Mail className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-bold font-mono text-lg">Email digest</h3>
                        <p className="text-sm text-muted-foreground">
                            Saved for later. Email digests are not sent yet.
                        </p>
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
                        <li>In-app notifications appear in your notification center (and over realtime when connected)</li>
                        <li>Email and push delivery are not live yet. Toggles are reserved for a future release</li>
                        <li>Some critical security notifications cannot be disabled</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
