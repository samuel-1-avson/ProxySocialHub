"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
    Globe, 
    Server, 
    Activity, 
    ChevronRight, 
    Info, 
    Settings, 
    Loader2, 
    Zap, 
    Save, 
    Terminal, 
    Cpu, 
    Eye, 
    Layout, 
    RefreshCcw,
    MousePointer2,
    Plus,
    AlertTriangle,
    X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { ApiError } from '@/lib/api/client';
import {
    getProviderServiceConfigs,
    getProviderServiceTemplates,
    updateProviderServiceConfig,
    createProviderServiceConfig,
    getMyNodes,
    type ProviderServiceConfig,
    type ProviderServiceTemplate,
    type NodeRegistration,
} from '@/lib/api/provider';

const TIERS = [
    { value: 'standard', label: 'Standard', color: '#6b7280' },
    { value: 'priority', label: 'Priority', color: '#f59e0b' },
    { value: 'enterprise', label: 'Enterprise', color: '#8b5cf6' },
];

const containerVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.1 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
};

function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
    return fallback;
}

export default function ProviderServicesPage() {
    const queryClient = useQueryClient();
    const [selectedConfig, setSelectedConfig] = useState<ProviderServiceConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [creatingNodeId, setCreatingNodeId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bandwidthDraft, setBandwidthDraft] = useState<string>('');

    const { data: configs = [], isLoading: configsLoading } = useQuery({
        queryKey: ['provider-service-configs'],
        queryFn: getProviderServiceConfigs,
        retry: 2,
    });

    const { data: nodesData, isLoading: nodesLoading } = useQuery({
        queryKey: ['provider-nodes-for-services'],
        queryFn: getMyNodes,
        retry: 2,
    });
    const nodes: NodeRegistration[] = nodesData?.nodes || [];

    const { data: templatesData } = useQuery({
        queryKey: ['provider-service-templates'],
        queryFn: getProviderServiceTemplates,
        retry: 2,
    });

    const templates = templatesData?.templates || [];

    const configuredNodeIds = new Set(configs.map((c) => c.node_id));
    const nodesWithoutConfig = nodes.filter((n) => !configuredNodeIds.has(n.id));

    // Keep the bandwidth draft in sync whenever a different config is selected
    // (or the server-confirmed value changes), without clobbering in-progress edits.
    useEffect(() => {
        setBandwidthDraft(selectedConfig ? String(selectedConfig.max_bandwidth_mbps) : '');
        // Deliberately narrow deps: only reset the draft when the node selection changes or the
        // server-confirmed bandwidth changes, so editing other fields doesn't clobber in-progress typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedConfig?.id, selectedConfig?.max_bandwidth_mbps]);

    const loading = configsLoading || nodesLoading;

    const updateConfig = async (nodeId: string, updates: Partial<ProviderServiceConfig>) => {
        setSaving(true);
        setError(null);
        try {
            const updated = await updateProviderServiceConfig(nodeId, updates);
            queryClient.invalidateQueries({ queryKey: ['provider-service-configs'] });
            if (selectedConfig && selectedConfig.node_id === nodeId) {
                setSelectedConfig(updated);
            }
        } catch (err) {
            console.error('Failed to update config:', err);
            setError(getErrorMessage(err, 'Failed to update service config. Please try again.'));
        } finally {
            setSaving(false);
        }
    };

    const commitBandwidthDraft = () => {
        if (!selectedConfig) return;
        const parsed = parseInt(bandwidthDraft, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            setBandwidthDraft(String(selectedConfig.max_bandwidth_mbps));
            return;
        }
        if (parsed === selectedConfig.max_bandwidth_mbps) return;
        updateConfig(selectedConfig.node_id, { max_bandwidth_mbps: parsed });
    };

    const applyTemplate = async (nodeId: string, template: ProviderServiceTemplate) => {
        await updateConfig(nodeId, template.config);
    };

    const createConfig = async (nodeId: string) => {
        setCreatingNodeId(nodeId);
        setError(null);
        try {
            const created = await createProviderServiceConfig({ node_id: nodeId });
            await queryClient.invalidateQueries({ queryKey: ['provider-service-configs'] });
            setSelectedConfig(created);
        } catch (err) {
            console.error('Failed to create config:', err);
            setError(getErrorMessage(err, 'Failed to create service config. Please try again.'));
        } finally {
            setCreatingNodeId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Syncing logic blocks...</p>
            </div>
        );
    }

    return (
        <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 pb-20"
        >
            {/* Header Section */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Terminal size={12} className="animate-pulse" /> Provisioning Engine v4.0
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Node Logistics
                    </h1>
                </div>
            </motion.div>

            {/* Error banner */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 flex items-start gap-3">
                            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                            <p className="flex-1 text-[11px] font-mono font-bold text-rose-300">{error}</p>
                            <button
                                onClick={() => setError(null)}
                                className="text-rose-300/60 hover:text-rose-300 transition-colors shrink-0"
                                aria-label="Dismiss error"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                {/* Left Column: Nodes & Templates */}
                <div className="lg:col-span-5 space-y-10">
                    
                    {/* Nodes Section */}
                    <motion.div variants={itemVariants} className="space-y-6">
                        <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                            <Server size={16} className="text-primary" /> Connected Node Overlay ({configs.length})
                        </h2>
                        
                        {configs.length === 0 && nodesWithoutConfig.length === 0 ? (
                            <GlassCard className="p-16 text-center border-dashed border-border opacity-80">
                                <div className="mb-6 mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                                    <Cpu size={32} className="text-muted-foreground" />
                                </div>
                                <h3 className="text-[11px] font-black font-mono uppercase mb-2">No Nodes Detected</h3>
                                <p className="text-[9px] font-mono text-muted-foreground uppercase leading-relaxed font-black mb-6">
                                    Connect a node via CLI or the setup wizard to start provisioning.
                                </p>
                                <Link
                                    href="/dashboard/provider/setup"
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl text-[10px] font-black font-mono uppercase tracking-widest hover:brightness-110 transition-all"
                                >
                                    <Plus size={14} /> Go to Setup
                                </Link>
                            </GlassCard>
                        ) : (
                            <div className="space-y-3">
                                {configs.map((config) => (
                                    <motion.button
                                        key={config.id}
                                        whileHover={{ x: 5 }}
                                        onClick={() => setSelectedConfig(config)}
                                        className={`w-full p-5 flex items-center justify-between rounded-2xl border transition-all text-left ${
                                            selectedConfig?.id === config.id
                                                ? 'bg-primary/10 border-primary/50 text-foreground shadow-lg shadow-primary/5'
                                                : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted'
                                        }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-xl border ${
                                                selectedConfig?.id === config.id ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border'
                                            }`}>
                                                <Activity size={20} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-[11px] font-black font-mono uppercase">{config.node?.ip_address || 'Unidentified Node'}</p>
                                                    <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-[8px] font-black uppercase tracking-tighter opacity-60">
                                                        {config.node?.country_code || '??'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${config.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                                                    <span className="text-[9px] font-mono font-black uppercase tracking-tighter opacity-40">
                                                        {config.is_active ? 'Streaming' : 'Deactivated'}
                                                    </span>
                                                    <span className="text-[9px] font-mono font-black uppercase tracking-tighter opacity-20 ml-2">
                                                        {config.max_bandwidth_mbps} Mbps
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={14} className={`transition-transform duration-300 ${selectedConfig?.id === config.id ? 'rotate-90 text-primary' : 'opacity-20'}`} />
                                    </motion.button>
                                ))}

                                {nodesWithoutConfig.length > 0 && (
                                    <div className="space-y-3 pt-2">
                                        <p className="text-[9px] font-mono font-black uppercase tracking-widest text-muted-foreground opacity-60">
                                            {configs.length === 0 ? 'Create a service config to get started' : 'Nodes awaiting a service config'}
                                        </p>
                                        {nodesWithoutConfig.map((node) => (
                                            <div
                                                key={node.id}
                                                className="w-full p-5 flex items-center justify-between rounded-2xl border border-dashed border-border bg-transparent text-left"
                                            >
                                                <div className="flex items-center gap-4 min-w-0">
                                                    <div className="p-2.5 rounded-xl border border-border bg-muted text-muted-foreground shrink-0">
                                                        <Server size={20} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[11px] font-black font-mono uppercase truncate">
                                                            {node.name || node.ip_address || 'Unnamed Node'}
                                                        </p>
                                                        <p className="text-[9px] font-mono font-black uppercase tracking-tighter opacity-40">
                                                            {node.country || '??'} · No service config
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => createConfig(node.id)}
                                                    disabled={creatingNodeId === node.id}
                                                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-[9px] font-black font-mono uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50"
                                                >
                                                    {creatingNodeId === node.id ? (
                                                        <Loader2 size={12} className="animate-spin" />
                                                    ) : (
                                                        <Plus size={12} />
                                                    )}
                                                    Create config
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>

                    {/* Quick Templates Section */}
                    <motion.div variants={itemVariants} className="space-y-6">
                        <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                            <Zap size={16} className="text-primary" /> Logic Presets
                        </h2>
                        <div className="grid grid-cols-2 gap-4">
                            {templates.map((template) => (
                                <motion.button
                                    key={template.name}
                                    whileHover={{ y: -3 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => selectedConfig && applyTemplate(selectedConfig.node_id, template)}
                                    disabled={!selectedConfig}
                                    className="p-5 glass-card border-border bg-muted/40 hover:border-primary/40 hover:bg-primary/5 transition-all text-left disabled:opacity-20 group"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="p-2 bg-muted rounded-lg border border-border group-hover:text-primary transition-colors">
                                            <Layout size={14} />
                                        </div>
                                        <div className="p-1 px-1.5 bg-primary/10 rounded text-primary text-[7px] font-black uppercase tracking-widest hidden group-hover:block animate-in fade-in zoom-in-50">Apply</div>
                                    </div>
                                    <h3 className="text-[10px] font-black font-mono uppercase mb-1 tracking-tight">{template.name}</h3>
                                    <p className="text-[8px] font-mono text-muted-foreground leading-tight uppercase font-black">{template.description}</p>
                                </motion.button>
                            ))}
                        </div>
                    </motion.div>

                </div>

                {/* Right Column: Configuration Panel */}
                <motion.div variants={itemVariants} className="lg:col-span-7">
                    <AnimatePresence mode="wait">
                        {selectedConfig ? (
                            <motion.div
                                key={selectedConfig.id}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <GlassCard className="p-10 border-border bg-muted/20 shadow-2xl relative overflow-hidden min-h-[600px]">
                                    <div className="absolute top-0 right-0 p-8 opacity-5">
                                        <Settings size={220} className="animate-spin-slow" />
                                    </div>

                                    <div className="flex justify-between items-start mb-12 relative z-10">
                                        <div className="flex items-center gap-5">
                                            <div className="p-4 bg-primary/20 rounded-2xl border border-primary/40 text-primary">
                                                <Settings size={32} />
                                            </div>
                                            <div>
                                                <h3 className="text-2xl font-black font-mono uppercase tracking-tighter">Parameterization</h3>
                                                <p className="text-[10px] font-mono text-muted-foreground font-black uppercase tracking-widest opacity-60">Modulating {selectedConfig.node?.ip_address}</p>
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <span className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground group-hover:text-primary transition-colors">
                                                {selectedConfig.is_active ? 'Node Active' : 'Node Deactivated'}
                                            </span>
                                            <div 
                                                onClick={() => updateConfig(selectedConfig.node_id, { is_active: !selectedConfig.is_active })}
                                                className={`w-14 h-7 rounded-full p-1 transition-all duration-500 border-2 ${
                                                    selectedConfig.is_active ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-muted border-border'
                                                }`}
                                            >
                                                <motion.div 
                                                    animate={{ x: selectedConfig.is_active ? 28 : 0 }}
                                                    className={`w-4 h-4 rounded-full transition-colors ${selectedConfig.is_active ? 'bg-primary shadow-lg shadow-primary/20' : 'bg-muted-foreground/50'}`} 
                                                />
                                            </div>
                                        </label>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
                                        
                                        {/* Protocols Section */}
                                        <div className="space-y-6 md:col-span-2">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-70 flex items-center gap-2">
                                                <Globe size={12} /> Communication Protocols
                                            </label>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                {[
                                                    { key: 'enable_http' as const, label: 'HTTP' },
                                                    { key: 'enable_https' as const, label: 'HTTPS' },
                                                    { key: 'enable_socks5' as const, label: 'SOCKS5' },
                                                    { key: 'enable_ssh_tunnel' as const, label: 'SSH' },
                                                ].map(proto => (
                                                    <button
                                                        key={proto.key}
                                                        onClick={() => updateConfig(selectedConfig.node_id, { [proto.key]: !selectedConfig[proto.key] })}
                                                        className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${
                                                            selectedConfig[proto.key] 
                                                                ? 'bg-primary/10 border-primary/50 text-foreground' 
                                                                : 'bg-muted/40 border-border text-muted-foreground opacity-50 hover:opacity-80'
                                                        }`}
                                                    >
                                                        <span className="text-[10px] font-black font-mono uppercase tracking-widest">{proto.label}</span>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${selectedConfig[proto.key] ? 'bg-primary animate-pulse shadow-[0_0_10px_rgba(34,197,94,1)]' : 'bg-border'}`} />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Tier Selection */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-70 flex items-center gap-2">
                                                <Layout size={12} /> Service Tiering
                                            </label>
                                            <div className="flex bg-muted p-1.5 rounded-2xl border border-border gap-2">
                                                {TIERS.map(t => (
                                                    <button
                                                        key={t.value}
                                                        onClick={() => updateConfig(selectedConfig.node_id, { priority_tier: t.value as ProviderServiceConfig['priority_tier'] })}
                                                        className={`flex-1 py-3 rounded-xl text-[9px] font-mono font-black uppercase transition-all ${
                                                            selectedConfig.priority_tier === t.value 
                                                                ? 'bg-primary text-primary-foreground shadow-lg' 
                                                                : 'text-muted-foreground hover:bg-muted-foreground/10'
                                                        }`}
                                                    >
                                                        {t.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Speed Setting */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-70 flex items-center gap-2">
                                                <Activity size={12} /> Max Bandwidth (Mbps)
                                            </label>
                                            <div className="relative group flex items-center gap-2">
                                                <div className="relative flex-1">
                                                    <input 
                                                        type="number" 
                                                        value={bandwidthDraft}
                                                        onChange={(e) => setBandwidthDraft(e.target.value)}
                                                        onBlur={commitBandwidthDraft}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') e.currentTarget.blur();
                                                        }}
                                                        className="w-full bg-muted border border-border rounded-2xl p-4 font-mono font-black text-foreground outline-none focus:border-primary/50 transition-all text-xl"
                                                    />
                                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 font-black font-mono text-xs uppercase pointer-events-none">Mbps</div>
                                                </div>
                                                {parseInt(bandwidthDraft, 10) !== selectedConfig.max_bandwidth_mbps && !Number.isNaN(parseInt(bandwidthDraft, 10)) && (
                                                    <button
                                                        onClick={commitBandwidthDraft}
                                                        title="Save bandwidth"
                                                        className="p-4 rounded-2xl bg-primary text-primary-foreground hover:brightness-110 transition-all shrink-0"
                                                    >
                                                        <Save size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Premium Features */}
                                        <div className="space-y-6 md:col-span-2 mt-4">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-70 flex items-center gap-2">
                                                <Zap size={12} /> Advanced Service Modulation
                                            </label>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                {[
                                                    { key: 'captcha_solving_enabled' as const, label: 'Captcha Decryption', icon: MousePointer2 },
                                                    { key: 'javascript_render_enabled' as const, label: 'Logic Rendering', icon: Cpu },
                                                    { key: 'screenshot_enabled' as const, label: 'Visual Capture', icon: Eye },
                                                ].map(feature => (
                                                    <button
                                                        key={feature.key}
                                                        onClick={() => updateConfig(selectedConfig.node_id, { [feature.key]: !selectedConfig[feature.key] })}
                                                        className={`p-5 rounded-2xl border flex items-center gap-4 transition-all text-left group ${
                                                            selectedConfig[feature.key]
                                                                ? 'bg-muted border-primary/40 text-foreground'
                                                                : 'bg-muted/40 border-border text-muted-foreground opacity-60 hover:opacity-90'
                                                        }`}
                                                    >
                                                        <div className={`p-2 rounded-lg border ${selectedConfig[feature.key] ? 'border-primary/40 text-primary' : 'border-border'}`}>
                                                            <feature.icon size={16} />
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-[9px] font-black font-mono uppercase leading-tight">{feature.label}</p>
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <div className={`w-1 h-1 rounded-full ${selectedConfig[feature.key] ? 'bg-primary' : 'bg-border'}`} />
                                                                <span className="text-[7px] font-black font-mono uppercase tracking-widest opacity-60">
                                                                    {selectedConfig[feature.key] ? 'Active' : 'Offline'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                    </div>

                                    <div className="mt-12 p-6 bg-muted rounded-2xl border border-border flex items-start gap-4">
                                        <div className="p-2 bg-blue-500/20 rounded-lg border border-blue-500/40 text-blue-500 shrink-0">
                                            <Info size={16} />
                                        </div>
                                        <p className="text-[10px] font-mono text-muted-foreground leading-relaxed uppercase font-black italic">
                                            Any changes to protocol parameters are propagated to the Edge-Gateway in real-time. Unauthorized traffic spikes will trigger automatic throttle mechanisms.
                                        </p>
                                    </div>

                                    {saving && (
                                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 rounded-3xl animate-in fade-in">
                                            <div className="flex flex-col items-center gap-3">
                                                <RefreshCcw className="w-8 h-8 text-primary animate-spin" />
                                                <p className="text-[10px] font-black font-mono uppercase text-primary tracking-widest animate-pulse">Syncing Engine...</p>
                                            </div>
                                        </div>
                                    )}
                                </GlassCard>
                            </motion.div>
                        ) : (
                            <GlassCard className="h-full min-h-[600px] border-dashed border-border p-10 flex flex-col items-center justify-center text-center opacity-70">
                                <div className="p-8 bg-muted rounded-full border border-border mb-8 animate-pulse">
                                    <MousePointer2 size={64} className="text-muted-foreground" />
                                </div>
                                <h3 className="text-sm font-black font-mono uppercase mb-3">Protocol Interface Standby</h3>
                                <p className="text-[10px] font-mono text-muted-foreground uppercase leading-relaxed max-w-sm font-black">
                                    {configs.length === 0
                                        ? 'Create a service config for one of your nodes to begin logistical parameterization.'
                                        : 'Select a node from the segment overlay to begin logistical parameterization and protocol modulation.'}
                                </p>
                            </GlassCard>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </motion.div>
    );
}
