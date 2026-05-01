'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Send, X, Loader2, Globe, Zap } from 'lucide-react';
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

const INTENTS = [
    { value: 'web_scraping', label: 'Web Scraping', icon: '🌐' },
    { value: 'vpn', label: 'VPN / Privacy', icon: '🔒' },
    { value: 'gaming', label: 'Gaming', icon: '🎮' },
    { value: 'social_media', label: 'Social Media Management', icon: '📱' },
    { value: 'seo', label: 'SEO / Marketing', icon: '📈' },
    { value: 'testing', label: 'Testing / Development', icon: '🧪' },
    { value: 'other', label: 'Other', icon: '📋' },
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
                <DialogContent className="sm:max-w-md bg-black/90 border-white/10">
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <MessageSquare className="w-8 h-8 text-emerald-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Message Sent!</h3>
                        <p className="text-sm text-white/60 text-center">
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
            <DialogContent className="sm:max-w-lg bg-black/95 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <MessageSquare className="w-5 h-5 text-emerald-500" />
                        Message {providerName}
                    </DialogTitle>
                </DialogHeader>

                {/* Listing Context */}
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                            <Zap className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-white truncate">
                                {listingTitle}
                            </h4>
                            <div className="flex items-center gap-2 text-xs text-white/50">
                                {location && (
                                    <span className="flex items-center gap-1">
                                        <Globe className="w-3 h-3" />
                                        {location}
                                    </span>
                                )}
                                {pricePerGb && (
                                    <span>${pricePerGb}/GB</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Intent Selection */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-white/70 uppercase tracking-wider">
                        What will you use this for?
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {INTENTS.map((i) => (
                            <button
                                key={i.value}
                                onClick={() => setIntent(i.value)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                                    intent === i.value
                                        ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400'
                                        : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
                                }`}
                            >
                                <span>{i.icon}</span>
                                <span>{i.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Expected Usage */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-white/70 uppercase tracking-wider">
                        Expected monthly usage
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {EXPECTED_USAGE.map((u) => (
                            <button
                                key={u.value}
                                onClick={() => setExpectedGb(u.value)}
                                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                                    expectedGb === u.value
                                        ? 'bg-emerald-500 text-black font-medium'
                                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                                }`}
                            >
                                {u.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Message Input */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-white/70 uppercase tracking-wider">
                        Your message
                    </label>
                    <Textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Hi! I'm interested in this proxy..."
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 min-h-[100px] resize-none"
                    />
                </div>

                {/* Provider Status */}
                <div className="flex items-center gap-2 text-xs text-white/50">
                    <span className={`w-2 h-2 rounded-full ${providerOnline ? 'bg-emerald-500 animate-pulse' : 'bg-white/30'}`} />
                    <span>{providerOnline ? 'Online now' : 'Offline'}</span>
                    <span className="mx-1">•</span>
                    <span>Typical response: ~15 min</span>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        className="flex-1 bg-white/5 border-white/10 text-white hover:bg-white/10"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSend}
                        disabled={isSending || !message.trim()}
                        className="flex-1 bg-emerald-500 text-black hover:bg-emerald-400"
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
