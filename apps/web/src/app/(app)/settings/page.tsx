'use client';

import { useAuth } from '@/lib/auth';
import { useState } from 'react';
import {
    Settings,
    User as UserIcon,
    Bell,
    Shield,
    Trash2,
    ChevronRight,
    Mail,
    Lock,
    Eye,
    EyeOff,
    Zap,
    ShieldCheck,
    Smartphone,
    Globe,
    CreditCard
} from 'lucide-react';

export default function SettingsPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState('general');

    const sections = [
        { id: 'general', label: 'Identity Protocol', icon: UserIcon, desc: 'Personal profile and presence' },
        { id: 'notifications', label: 'Signal Overlays', icon: Bell, desc: 'Alert configurations and filters' },
        { id: 'security', label: 'Encryption & Keys', icon: Shield, desc: 'Session tokens and access control' },
        { id: 'billing', label: 'Credit Stream', icon: CreditCard, desc: 'Transaction history and methods' },
        { id: 'danger', label: 'Format Protocol', icon: Trash2, danger: true, desc: 'Account termination and data wipe' },
    ];

    return (
        <div className="max-w-6xl mx-auto pb-32 relative px-4">
            {/* Background Aesthetics */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full -z-10 animate-pulse"></div>
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 blur-[100px] rounded-full -z-10"></div>

            <div className="flex flex-col md:flex-row gap-12 pt-12">
                {/* Sidebar Navigation */}
                <div className="w-full md:w-80 space-y-10 shrink-0">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mb-4">
                            <Zap size={10} className="text-primary" />
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-primary">System Config</span>
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tighter">Command <span className="text-primary italic">Node</span></h1>
                        <p className="text-muted-foreground text-sm mt-2 leading-relaxed">Adjust your network parameters and security protocols.</p>
                    </div>

                    <nav className="space-y-2">
                        {sections.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setActiveSection(item.id)}
                                className={`w-full group flex items-start gap-4 p-5 rounded-[1.5rem] transition-all duration-300 text-left border ${activeSection === item.id
                                    ? "bg-white/[0.05] border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.2)]"
                                    : "border-transparent text-muted-foreground hover:bg-white/[0.02] hover:text-white"
                                    } ${item.danger && activeSection === item.id ? "bg-destructive/5 border-destructive/20" : ""}`}
                            >
                                <div className={`p-2.5 rounded-xl transition-colors ${activeSection === item.id
                                    ? (item.danger ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary")
                                    : "bg-white/5 group-hover:bg-white/10"}`}>
                                    <item.icon size={18} />
                                </div>
                                <div className="space-y-0.5">
                                    <p className={`text-sm font-black uppercase tracking-widest ${activeSection === item.id ? "text-white" : ""}`}>
                                        {item.label}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground line-clamp-1">{item.desc}</p>
                                </div>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Main Panel Content */}
                <div className="flex-1 space-y-8 animate-in fade-in slide-in-from-right-10 duration-500">
                    {activeSection === 'general' && (
                        <div className="space-y-8">
                            <div className="p-10 rounded-[2.5rem] bg-white/[0.03] border border-white/5 backdrop-blur-3xl shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2 group-hover:bg-primary/10 transition-colors"></div>
                                <div className="relative z-10 flex items-center justify-between mb-10">
                                    <h2 className="text-2xl font-black text-white tracking-tighter">Public Data Core</h2>
                                    <button className="px-5 py-2 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black text-primary uppercase tracking-[0.2em] hover:bg-primary hover:text-black transition-all">
                                        Update Metadata
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 ml-1">Credential Index</label>
                                        <div className="flex items-center gap-4 p-5 rounded-2xl bg-[#050505]/50 border border-white/5 text-white/40 text-sm font-medium">
                                            <Mail size={16} className="text-primary/50" />
                                            <span className="truncate">{user?.email}</span>
                                            <ShieldCheck size={14} className="ml-auto text-emerald-500" />
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 ml-1">Protocol Alias</label>
                                        <div className="flex items-center gap-4 p-5 rounded-2xl bg-[#050505]/50 border border-white/5 text-white text-sm font-bold italic">
                                            <UserIcon size={16} className="text-primary/50" />
                                            {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Anonymous_Node'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-10 rounded-[2.5rem] bg-white/[0.03] border border-white/5 backdrop-blur-3xl shadow-2xl">
                                <h2 className="text-xl font-black text-white tracking-tighter mb-8 italic">Signal Preferences</h2>
                                <div className="space-y-4">
                                    {[
                                        { label: 'Push Overlays', desc: 'Real-time heads-up alerts for message/circle streams', active: true, icon: Smartphone },
                                        { label: 'Stealth Mode', desc: 'Mask your node activity from global discovery scans', active: false, icon: Globe },
                                        { label: 'Market Comms', desc: 'Receive encrypted updates on new network protocols', active: true, icon: Zap },
                                    ].map((pref, i) => (
                                        <div key={i} className="flex items-center justify-between p-6 rounded-2xl bg-white/[0.02] border border-transparent hover:border-white/5 hover:bg-white/[0.04] transition-all group">
                                            <div className="flex items-center gap-6">
                                                <div className={`p-3 rounded-xl bg-white/5 text-white/20 group-hover:text-primary transition-colors`}>
                                                    <pref.icon size={20} />
                                                </div>
                                                <div>
                                                    <p className="text-md font-black text-white group-hover:text-primary transition-colors">{pref.label}</p>
                                                    <p className="text-xs text-muted-foreground opacity-60 italic">{pref.desc}</p>
                                                </div>
                                            </div>
                                            <button className={`w-14 h-7 rounded-full relative p-1.5 transition-all duration-500 shadow-inner ${pref.active ? "bg-primary" : "bg-white/10"}`}>
                                                <div className={`w-4 h-4 bg-white rounded-full shadow-lg transition-transform duration-500 ${pref.active ? "translate-x-7" : "translate-x-0"}`}></div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'danger' && (
                        <div className="p-12 rounded-[2.5rem] bg-destructive/5 border border-destructive/20 backdrop-blur-3xl shadow-2xl space-y-8 animate-in zoom-in-95 duration-300">
                            <div className="space-y-3">
                                <h2 className="text-3xl font-black text-destructive tracking-tighter uppercase italic">Nuclear Option</h2>
                                <p className="text-muted-foreground text-md leading-relaxed">
                                    Executing this protocol will permanently wipe all session data, wallet balances, and network associations. This action is <span className="text-destructive font-black underline">irreversible</span>.
                                </p>
                            </div>

                            <div className="p-6 rounded-2xl bg-black/40 border border-destructive/20 italic text-destructive/80 text-sm">
                                "Self-correction is the final act of a failed node."
                            </div>

                            <button className="w-full py-6 rounded-3xl bg-destructive/10 border border-destructive/30 text-destructive text-lg font-black uppercase tracking-widest hover:bg-destructive hover:text-white hover:scale-[1.02] active:scale-95 transition-all shadow-[0_20px_40px_-10px_rgba(239,68,68,0.2)]">
                                Initiate Wipe Protocol
                            </button>
                        </div>
                    )}

                    {/* Placeholder for other sections */}
                    {(activeSection === 'notifications' || activeSection === 'security' || activeSection === 'billing') && (
                        <div className="py-24 text-center space-y-6 rounded-[2.5rem] bg-white/[0.02] border border-white/5 border-dashed backdrop-blur-xl">
                            <div className="w-20 h-20 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/5 rotate-6">
                                <Settings size={40} />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-white/50 uppercase tracking-tighter italic">Subsystem Indexing</h3>
                                <p className="text-muted-foreground text-sm max-w-xs mx-auto italic">This control interface is currently under encryption review. Access will be granted in the next cycle.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

