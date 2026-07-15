"use client";

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
    Globe, 
    Shield, 
    Lock, 
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
    CheckCircle2, 
    RefreshCcw,
    MousePointer2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import {
    getProviderServiceConfigs,
    getProviderServiceTemplates,
    updateProviderServiceConfig,
    type ProviderServiceConfig,
    type ProviderServiceTemplate,
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

export default function ProviderServicesPage() {
    const queryClient = useQueryClient();
    const [selectedConfig, setSelectedConfig] = useState<ProviderServiceConfig | null>(null);
    const [saving, setSaving] = useState(false);

    const { data: configs = [], isLoading: loading } = useQuery({
        queryKey: ['provider-service-configs'],
        queryFn: getProviderServiceConfigs,
        retry: 2,
    });

    const { data: templatesData } = useQuery({
        queryKey: ['provider-service-templates'],
        queryFn: getProviderServiceTemplates,
        retry: 2,
    });

    const templates = templatesData?.templates || [];

    const updateConfig = async (nodeId: string, updates: Partial<ProviderServiceConfig>) => {
        setSaving(true);
        try {
            const updated = await updateProviderServiceConfig(nodeId, updates);
            queryClient.invalidateQueries({ queryKey: ['provider-service-configs'] });
            if (selectedConfig && selectedConfig.node_id === nodeId) {
                setSelectedConfig(updated);
            }
        } catch (err) {
            console.error('Failed to update config:', err);
        } finally {
            setSaving(false);
        }
    };

    const applyTemplate = async (nodeId: string, template: ProviderServiceTemplate) => {
        await updateConfig(nodeId, template.config);
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
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Terminal size={12} className="animate-pulse" /> Provisioning Engine v4.0
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Node Logistics
                    </h1>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                {/* Left Column: Nodes & Templates */}
                <div className="lg:col-span-5 space-y-10">
                    
                    {/* Nodes Section */}
                    <motion.div variants={itemVariants} className="space-y-6">
                        <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                            <Server size={16} className="text-primary" /> Connected Node Overlay ({configs.length})
                        </h2>
                        
                        {configs.length === 0 ? (
                            <GlassCard className="p-16 text-center border-dashed border-white/10 opacity-50">
                                <div className="mb-6 mx-auto w-16 h-16 bg-white/5 rounded-full flex items-center justify-center">
                                    <Cpu size={32} className="text-muted-foreground" />
                                </div>
                                <h3 className="text-[11px] font-black font-mono uppercase mb-2">No Nodes Detected</h3>
                                <p className="text-[9px] font-mono text-muted-foreground uppercase leading-relaxed font-black">
                                    Connect a node via CLI to start provisioning.
                                </p>
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
                                                : 'bg-white/2 border-white/5 text-muted-foreground hover:bg-white/5'
                                        }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-xl border ${
                                                selectedConfig?.id === config.id ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-white/5 border-white/10'
                                            }`}>
                                                <Activity size={20} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-[11px] font-black font-mono uppercase">{config.node?.ip_address || 'Unidentified Node'}</p>
                                                    <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] font-black uppercase tracking-tighter opacity-60">
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
                                    className="p-5 glass-card border-white/5 bg-white/2 hover:border-primary/40 hover:bg-primary/5 transition-all text-left disabled:opacity-20 group"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="p-2 bg-white/5 rounded-lg border border-white/10 group-hover:text-primary transition-colors">
                                            <Layout size={14} />
                                        </div>
                                        <div className="p-1 px-1.5 bg-primary/10 rounded text-primary text-[7px] font-black uppercase tracking-widest hidden group-hover:block animate-in fade-in zoom-in-50">Apply</div>
                                    </div>
                                    <h3 className="text-[10px] font-black font-mono uppercase mb-1 tracking-tight">{template.name}</h3>
                                    <p className="text-[8px] font-mono text-muted-foreground/60 leading-tight uppercase font-black">{template.description}</p>
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
                                <GlassCard className="p-10 border-white/5 bg-white/2 shadow-2xl relative overflow-hidden min-h-[600px]">
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
                                                <p className="text-[10px] font-mono text-muted-foreground font-black uppercase tracking-widest opacity-40">Modulating {selectedConfig.node?.ip_address}</p>
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <span className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground group-hover:text-primary transition-colors">
                                                {selectedConfig.is_active ? 'Node Active' : 'Node Deactivated'}
                                            </span>
                                            <div 
                                                onClick={() => updateConfig(selectedConfig.node_id, { is_active: !selectedConfig.is_active })}
                                                className={`w-14 h-7 rounded-full p-1 transition-all duration-500 border-2 ${
                                                    selectedConfig.is_active ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-white/5 border-white/10'
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
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
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
                                                                : 'bg-white/2 border-white/5 text-muted-foreground opacity-30 hover:opacity-50'
                                                        }`}
                                                    >
                                                        <span className="text-[10px] font-black font-mono uppercase tracking-widest">{proto.label}</span>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${selectedConfig[proto.key] ? 'bg-primary animate-pulse shadow-[0_0_10px_rgba(34,197,94,1)]' : 'bg-white/30'}`} />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Tier Selection */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                                <Layout size={12} /> Service Tiering
                                            </label>
                                            <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 gap-2">
                                                {TIERS.map(t => (
                                                    <button
                                                        key={t.value}
                                                        onClick={() => updateConfig(selectedConfig.node_id, { priority_tier: t.value as any })}
                                                        className={`flex-1 py-3 rounded-xl text-[9px] font-mono font-black uppercase transition-all ${
                                                            selectedConfig.priority_tier === t.value 
                                                                ? 'bg-primary text-primary-foreground shadow-lg' 
                                                                : 'text-muted-foreground hover:bg-white/5'
                                                        }`}
                                                    >
                                                        {t.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Speed Setting */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
                                                <Activity size={12} /> Max Bandwidth (Mbps)
                                            </label>
                                            <div className="relative group">
                                                <input 
                                                    type="number" 
                                                    value={selectedConfig.max_bandwidth_mbps}
                                                    onChange={(e) => updateConfig(selectedConfig.node_id, { max_bandwidth_mbps: parseInt(e.target.value) })}
                                                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 font-mono font-black text-foreground outline-none focus:border-primary/50 transition-all text-xl"
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 font-black font-mono text-xs uppercase">Mbps</div>
                                            </div>
                                        </div>

                                        {/* Premium Features */}
                                        <div className="space-y-6 md:col-span-2 mt-4">
                                            <label className="text-[10px] font-black font-mono uppercase tracking-widest text-muted-foreground opacity-60 flex items-center gap-2">
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
                                                                ? 'bg-white/5 border-primary/40 text-foreground'
                                                                : 'bg-white/2 border-white/5 text-muted-foreground opacity-40 hover:opacity-60'
                                                        }`}
                                                    >
                                                        <div className={`p-2 rounded-lg border ${selectedConfig[feature.key] ? 'border-primary/40 text-primary' : 'border-white/10'}`}>
                                                            <feature.icon size={16} />
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-[9px] font-black font-mono uppercase leading-tight">{feature.label}</p>
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <div className={`w-1 h-1 rounded-full ${selectedConfig[feature.key] ? 'bg-primary' : 'bg-white/20'}`} />
                                                                <span className="text-[7px] font-black font-mono uppercase tracking-widest opacity-40">
                                                                    {selectedConfig[feature.key] ? 'Active' : 'Offline'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                    </div>

                                    <div className="mt-12 p-6 bg-white/5 rounded-2xl border border-white/10 flex items-start gap-4">
                                        <div className="p-2 bg-blue-500/20 rounded-lg border border-blue-500/40 text-blue-500 shrink-0">
                                            <Info size={16} />
                                        </div>
                                        <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed uppercase font-black italic">
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
                            <GlassCard className="h-full min-h-[600px] border-dashed border-white/10 p-10 flex flex-col items-center justify-center text-center opacity-40">
                                <div className="p-8 bg-white/5 rounded-full border border-white/10 mb-8 animate-pulse">
                                    <MousePointer2 size={64} className="text-muted-foreground" />
                                </div>
                                <h3 className="text-sm font-black font-mono uppercase mb-3">Protocol Interface Standby</h3>
                                <p className="text-[10px] font-mono text-muted-foreground uppercase leading-relaxed max-w-sm font-black">
                                    Select a node from the segment overlay to begin logistical parameterization and protocol modulation.
                                </p>
                            </GlassCard>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </motion.div>
    );
}
