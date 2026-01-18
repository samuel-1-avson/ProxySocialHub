'use client';

import { useAuth } from '@/lib/auth';
import { useState } from 'react';

export default function SettingsPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-12">
            <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                    Settings
                </h1>
                <p className="text-muted-foreground mt-1">Manage your account preferences and security.</p>
            </div>

            <div className="grid gap-6">
                {/* Profile Section */}
                <section className="bg-card/50 backdrop-blur-md border border-card-border rounded-xl p-6">
                    <h2 className="text-lg font-semibold mb-4">Profile Information</h2>
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <label className="text-sm font-medium text-muted-foreground">Display Name</label>
                            <div className="p-2.5 bg-background/50 border border-card-border rounded-lg text-foreground">
                                {user?.user_metadata?.full_name || 'Not set'}
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <label className="text-sm font-medium text-muted-foreground">Email Address</label>
                            <div className="p-2.5 bg-background/50 border border-card-border rounded-lg text-foreground opacity-70">
                                {user?.email}
                            </div>
                            <p className="text-xs text-muted-foreground italic">Email changes are handled via Supabase.</p>
                        </div>
                    </div>
                </section>

                {/* Preferences */}
                <section className="bg-card/50 backdrop-blur-md border border-card-border rounded-xl p-6 opacity-60">
                    <h2 className="text-lg font-semibold mb-4">Account Preferences</h2>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between py-2">
                            <div>
                                <p className="font-medium">Email Notifications</p>
                                <p className="text-xs text-muted-foreground">Receive updates about your activity.</p>
                            </div>
                            <div className="w-10 h-5 bg-primary/20 rounded-full relative">
                                <div className="absolute left-1 top-1 w-3 h-3 bg-primary rounded-full"></div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between py-2 border-t border-card-border/50">
                            <div>
                                <p className="font-medium">Public Profile</p>
                                <p className="text-xs text-muted-foreground">Allow others to see your activity feed.</p>
                            </div>
                            <div className="w-10 h-5 bg-card-border rounded-full relative">
                                <div className="absolute right-1 top-1 w-3 h-3 bg-background rounded-full"></div>
                            </div>
                        </div>
                    </div>
                    <p className="mt-4 text-xs text-center text-muted-foreground italic">Preference saving coming soon.</p>
                </section>

                {/* Danger Zone */}
                <section className="border border-destructive/20 bg-destructive/5 rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-destructive mb-2">Danger Zone</h2>
                    <p className="text-sm text-muted-foreground mb-4">Permanently delete your account and all associated data.</p>
                    <button
                        disabled
                        className="px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm font-medium hover:bg-destructive hover:text-white transition-all disabled:opacity-50"
                    >
                        Delete Account
                    </button>
                </section>
            </div>
        </div>
    );
}
