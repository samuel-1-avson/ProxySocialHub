"use client";

import { useCallback, useEffect, useState } from "react";
import { AtSign, Check, Copy, Key, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createAPIKey, listAPIKeys, revokeAPIKey, type APIKey } from "@/lib/services/security";

export function ApiKeysPanel() {
    const [loading, setLoading] = useState(true);
    const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
    const [newKeyName, setNewKeyName] = useState("");
    const [createdKey, setCreatedKey] = useState<string | null>(null);
    const [copiedKey, setCopiedKey] = useState(false);

    const loadKeys = useCallback(async () => {
        setLoading(true);
        try {
            const keys = await listAPIKeys();
            setApiKeys(keys);
        } catch (err) {
            console.error("Failed to load API keys", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadKeys();
    }, [loadKeys]);

    const handleCreateKey = async () => {
        if (!newKeyName.trim()) return;
        try {
            const { api_key, ...keyData } = await createAPIKey(newKeyName.trim());
            setCreatedKey(api_key);
            setApiKeys([keyData as APIKey, ...apiKeys]);
            setNewKeyName("");
        } catch (err) {
            console.error("Failed to create key", err);
        }
    };

    const handleRevokeKey = async (id: string) => {
        try {
            await revokeAPIKey(id);
            setApiKeys(apiKeys.filter((k) => k.id !== id));
        } catch (err) {
            console.error("Failed to revoke key", err);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[40vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div>
                <h2 className="text-2xl font-black font-mono uppercase tracking-tighter flex items-center gap-2">
                    <Key size={22} className="text-primary" />
                    API keys
                </h2>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                    Tokens for CLI, agents, and automated nodes
                </p>
            </div>

            <GlassCard className="p-0 border-white/10 overflow-hidden">
                <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                            <Key size={20} />
                        </div>
                        <h3 className="font-black font-sans italic uppercase text-sm tracking-tight">
                            Identity session tokens
                        </h3>
                    </div>
                    <div className="text-[10px] font-mono text-emerald-500/60 uppercase tracking-widest hidden md:block">
                        Active keys: {apiKeys.length} / 10
                    </div>
                </div>

                <div className="p-10 space-y-8">
                    <p className="text-[11px] font-mono text-muted-foreground uppercase leading-relaxed max-w-2xl">
                        Use identity tokens for automated nodes, AI agents, or CLI access. They provide
                        limited-scope access without a wallet signature on every heartbeat.
                    </p>

                    <div className="flex gap-4 p-4 rounded-2xl bg-black/40 border border-white/5">
                        <Input
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            placeholder="NAME YOUR TOKEN (e.g. EDGE_NODE_01)"
                            className="h-12 bg-transparent border-none font-mono text-xs uppercase focus:ring-0"
                        />
                        <Button
                            onClick={handleCreateKey}
                            disabled={!newKeyName.trim()}
                            className="h-12 px-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black font-mono text-[10px] uppercase tracking-widest"
                        >
                            Generate token
                        </Button>
                    </div>

                    {createdKey && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-4"
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] font-black font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                                    <ShieldCheck size={14} /> Critical security key generated
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(createdKey);
                                        setCopiedKey(true);
                                        setTimeout(() => setCopiedKey(false), 2000);
                                    }}
                                    className="text-emerald-400 hover:text-emerald-300 flex items-center gap-2 text-[10px] font-mono"
                                >
                                    {copiedKey ? <Check size={14} /> : <Copy size={14} />}{" "}
                                    {copiedKey ? "COPIED" : "COPY KEY"}
                                </button>
                            </div>
                            <div className="p-4 bg-black/60 rounded-xl font-mono text-sm text-emerald-500 break-all border border-emerald-500/20">
                                {createdKey}
                            </div>
                            <p className="text-[9px] font-mono text-emerald-500/60 uppercase">
                                Warning: This key will never be shown again. Store it in a secure vault immediately.
                            </p>
                            <Button
                                variant="ghost"
                                className="text-[9px] text-white/40 hover:text-white uppercase font-mono"
                                onClick={() => setCreatedKey(null)}
                            >
                                Dismiss
                            </Button>
                        </motion.div>
                    )}

                    <div className="space-y-4">
                        {apiKeys.map((key) => (
                            <div
                                key={key.id}
                                className="flex items-center justify-between p-5 bg-white/2 border border-white/5 rounded-2xl hover:border-white/10 transition-all"
                            >
                                <div className="flex items-center gap-6">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40">
                                        <AtSign size={18} />
                                    </div>
                                    <div>
                                        <p className="font-black font-mono text-xs uppercase tracking-tight text-white/80">
                                            {key.name}
                                        </p>
                                        <p className="text-[9px] font-mono text-muted-foreground mt-1 uppercase opacity-60">
                                            Prefix: {key.prefix} • Last used:{" "}
                                            {key.last_used_at
                                                ? new Date(key.last_used_at).toLocaleDateString()
                                                : "NEVER"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleRevokeKey(key.id)}
                                    className="p-3 text-rose-500/40 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all"
                                    aria-label={`Revoke ${key.name}`}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        {apiKeys.length === 0 && (
                            <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl opacity-20">
                                <p className="text-[10px] font-mono uppercase tracking-widest">No active identity tokens</p>
                            </div>
                        )}
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}
