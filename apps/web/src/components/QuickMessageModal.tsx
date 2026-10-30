'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Send, Loader2, Globe, Zap, Lock, Gamepad2, Smartphone, TrendingUp, FlaskConical, ClipboardList } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getAccessTokenSilently, useAuth } from '@/lib/auth';
import { useNotificationStore } from '@/stores';
import { useRouter } from 'next/navigation';

interface QuickMessageModalProps {
    isOpen: boolean;
    onClose: () => void;
    listingId: string;
    listingTitle: string;
    providerId: string;
    providerName: string;
    providerAvatar?: string;
    providerOnline?: boolean;
    pricePerGb?: number;
    location?: string;
}

const INTENTS: { value: string; label: string; icon: LucideIcon }[] = [
    { value: 'web_scraping', label: 'Web Scraping', icon: Globe },
    { value: 'vpn', label: 'VPN / Privacy', icon: Lock },
    { value: 'gaming', label: 'Gaming', icon: Gamepad2 },
    { value: 'social_media', label: 'Social Media Management', icon: Smartphone },
    { value: 'seo', label: 'SEO / Marketing', icon: TrendingUp },
    { value: 'testing', label: 'Testing / Development', icon: FlaskConical },
    { value: 'other', label: 'Other', icon: ClipboardList },
];

const EXPECTED_USAGE = [
    { value: 10, label: '~10 GB/month' },
    { value: 50, label: '~50 GB/month' },
    { value: 100, label: '~100 GB/month' },
    { value: 500, label: '~500 GB/month' },
    { value: 1000, label: '1 TB+/month' },
];

export function QuickMessageModal({
    isOpen,
    onClose,
    listingId,
    listingTitle,
    providerId,
    providerName,
    providerAvatar,
    providerOnline = false,
    pricePerGb,
    location,
}: QuickMessageModalProps) {
    const { user, isAuthenticated } = useAuth();
    const { addNotification } = useNotificationStore();
    const router = useRouter();
    
    const [message, setMessage] = useState('');
    const [intent, setIntent] = useState('');
    const [expectedGb, setExpectedGb] = useState<number | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [step, setStep] = useState<'form' | 'success'>('form');

    const handleSend = async () => {
        if (!isAuthenticated) {
            addNotification({
                type: 'error',
                title: 'Authentication required',
                message: 'Please sign in to message providers',
            });
            router.push('/auth/login?redirect=' + encodeURIComponent(window.location.pathname));
            return;
        }

        if (!message.trim()) {
            addNotification({
                type: 'error',
                title: 'Message required',
                message: 'Please enter a message',
            });
            return;
        }

        setIsSending(true);

        try {
            const token = await getAccessTokenSilently();
            const response = await fetch(`/v1/listings/${listingId}/inquire`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    message: message.trim(),
                    intent: intent || undefined,
                    expected_gb: expectedGb || undefined,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to send message');
            }

            const data = await response.json();
            
            setStep('success');
            
            addNotification({
                type: 'success',
                title: 'Message sent!',
                message: `${providerName} will be notified.`,
            });

            // Close after 2 seconds
            setTimeout(() => {
                onClose();
                setStep('form');
                setMessage('');
                setIntent('');
                setExpectedGb(null);
                
                // Optionally navigate to messages
                // router.push('/messages');
            }, 2000);

        } catch (error: any) {
            addNotification({
                type: 'error',
                title: 'Failed to send',
                message: error.message,
            });
        } finally {
            setIsSending(false);
        }
    };

    const getPrefillMessage = () => {
        if (intent) {
            const intentLabel = INTENTS.find(i => i.value === intent)?.label || intent;
            return `Hi! I'm interested in your ${listingTitle} for ${intentLabel.toLowerCase()}.`;
        }
        return `Hi! I'm interested in your ${listingTitle}.`;
    };

    // Set prefill when intent changes and message is empty
    React.useEffect(() => {
        if (intent && !message) {
            setMessage(getPrefillMessage());
        }
    }, [intent]);

    if (step === 'success') {
        return (
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="sm:max-w-md bg-card border-border">
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                        <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center">
                            <MessageSquare className="w-8 h-8 text-success" />
                        </div>
                        <h3 className="text-lg font-semibold text-foreground">Message Sent!</h3>
                        <p className="text-sm text-muted-foreground text-center">
                            {providerName} has been notified and will respond soon.
                        </p>
                        <Button 
                            onClick={() => router.push('/messages')}
                            className="mt-4"
                        >
                            Go to Messages
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <MessageSquare className="w-5 h-5 text-success" />
                        Message {providerName}
                    </DialogTitle>
                </DialogHeader>

                {/* Listing Context */}
                <div className="bg-secondary rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                            <Zap className="w-5 h-5 text-success" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-foreground truncate">
                                {listingTitle}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {location && (
                                    <span className="flex items-center gap-1">
                                        <Globe className="w-3 h-3" />
                                        {location}
                                    </span>
                                )}
                                {pricePerGb && (
                                    <span>${Number(pricePerGb).toFixed(4)}/GB</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Intent Selection */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">
                        What will you use this for?
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {INTENTS.map((i) => {
                            const Icon = i.icon;
                            const selected = intent === i.value;
                            return (
                                <button
                                    key={i.value}
                                    type="button"
                                    onClick={() => setIntent(i.value)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                                        selected
                                            ? 'bg-success/20 border border-success/50 text-success'
                                            : 'bg-secondary border border-border text-foreground hover:bg-secondary'
                                    }`}
                                >
                                    <Icon
                                        size={14}
                                        strokeWidth={1.75}
                                        className={`shrink-0 ${selected ? 'text-success' : 'text-muted-foreground'}`}
                                    />
                                    <span className="text-left leading-snug">{i.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Expected Usage */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">
                        Expected monthly usage
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {EXPECTED_USAGE.map((u) => (
                            <button
                                key={u.value}
                                onClick={() => setExpectedGb(u.value)}
                                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                                    expectedGb === u.value
                                        ? 'bg-success text-black font-medium'
                                        : 'bg-secondary text-muted-foreground hover:bg-secondary-light'
                                }`}
                            >
                                {u.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">
                        Your message
                    </label>
                    <Textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Hi! I'm interested in this proxy..."
                        className="bg-secondary border-border text-foreground placeholder:text-muted-foreground min-h-[100px] resize-none"
                    />
                </div>

                {/* Provider Status */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`w-2 h-2 rounded-full ${providerOnline ? 'bg-success animate-pulse' : 'bg-secondary-light'}`} />
                    <span>{providerOnline ? 'Online now' : 'Offline'}</span>
                    <span className="mx-1">•</span>
                    <span>Typical response: ~15 min</span>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        className="flex-1 bg-secondary border-border text-foreground hover:bg-secondary"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSend}
                        disabled={isSending || !message.trim()}
                        className="flex-1 bg-success text-black hover:bg-success"
                    >
                        {isSending ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="w-4 h-4 mr-2" />
                                Send Message
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
