"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateProfile, type UserPublicProfile } from "@/lib/services/profile";
import Link from "next/link";
import {
    User, Bell, Shield, Smartphone, Save, Globe,
    Briefcase, Hash, Twitter, Github, Linkedin,
    Plus, X, Loader2, Key, Monitor, Lock,
    AlertTriangle, LogOut, ArrowLeft, ChevronRight,
    AtSign, ShieldCheck, CreditCard
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type Tab = "General" | "Notifications" | "Security" | "Devices";

export default function SettingsPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("General");

    // Profile State
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [location, setLocation] = useState("");
    const [website, setWebsite] = useState("");
    const [skills, setSkills] = useState<string[]>([]);
    const [newSkill, setNewSkill] = useState("");
    const [socialLinks, setSocialLinks] = useState({ twitter: "", github: "", linkedin: "" });
    const [businessName, setBusinessName] = useState("");
    const [taxId, setTaxId] = useState("");

    // Load Profile
    useEffect(() => {
        async function loadProfile() {
            try {
                const data = await getMyProfile();
                setDisplayName(data.display_name || "");
                setBio(data.bio || "");
                setLocation(data.location || "");
                setWebsite(data.website || "");
                setSkills(data.skills || []);
                setBusinessName(data.business_name || "");
                if (data.social_links) {
                    setSocialLinks({
                        twitter: data.social_links.twitter || "",
                        github: data.social_links.github || "",
                        linkedin: data.social_links.linkedin || ""
                    });
                }
            } catch (err) {
                console.error("Failed to load profile", err);
            } finally {
                setLoading(false);
            }
        }
        if (user) loadProfile();
    }, [user]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateProfile({
                display_name: displayName,
                bio,
                location,
                website,
                skills,
                business_name: businessName,
                social_links: socialLinks,
            });
        } catch (err) {
            console.error("Failed to save", err);
        } finally {
            setSaving(false);
        }
    };

    const addSkill = () => {
        if (newSkill && !skills.includes(newSkill)) {
            setSkills([...skills, newSkill]);
            setNewSkill("");
        }
    };

    const removeSkill = (skill: string) => {
        setSkills(skills.filter(s => s !== skill));
    };

    if (loading) return (
        <div className="flex items-center justify-center min-h-[50vh]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
    );

    const tabs = [
        { id: "General", label: "General", icon: User, desc: "Account & Profile" },
        { id: "Notifications", label: "Notifications", icon: Bell, desc: "Alerts & Messages" },
        { id: "Security", label: "Security", icon: Shield, desc: "Keys & Protection" },
        { id: "Devices", label: "Devices", icon: Smartphone, desc: "Active Terminals" },
    ] as const;

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <div className="space-y-8 pb-20">
            {/* Header */}
            <div>
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
                    <Link href="/dashboard" className="group inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors font-mono text-[10px] font-black uppercase tracking-[0.2em] mb-6">
                        <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                        Return to Control Hub
                    </Link>
                </motion.div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <h1 className="text-4xl font-black font-mono uppercase tracking-tighter mb-1 bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                            Protocol Settings
                        </h1>
                        <p className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase opacity-60">
                            System configuration & identity parameters.
                        </p>
                    </motion.div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Nav Sidebar */}
                <div className="space-y-2">
                    {tabs.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all border ${activeTab === item.id
                                ? "bg-primary text-primary-foreground font-black shadow-[0_0_20px_rgba(16,185,129,0.3)] border-white/20"
                                : "bg-white/2 border-white/5 hover:border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"
                                }`}
                        >
                            <div className={`p-2 rounded-xl ${activeTab === item.id ? "bg-white/20" : "bg-white/5 text-primary"}`}>
                                <item.icon size={18} />
                            </div>
                            <div className="text-left">
                                <span className="block font-mono text-[11px] font-black uppercase tracking-wider">{item.label}</span>
                                <span className={`block text-[9px] font-mono uppercase opacity-40 ${activeTab === item.id ? "text-white" : ""}`}>{item.desc}</span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="lg:col-span-3">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            variants={containerVariants}
                            initial="hidden"
                            animate="show"
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-6"
                        >
                            {activeTab === "General" && (
                                <>
                                    {/* Identity Card */}
                                    <motion.div variants={itemVariants} className="glass-card overflow-hidden">
                                        <div className="p-6 border-b border-white/5 bg-white/5 flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                                <User size={18} />
                                            </div>
                                            <h2 className="font-black font-mono uppercase text-xs tracking-[0.2em]">Core Identity</h2>
                                        </div>
                                        <div className="p-8 space-y-8">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">Operator Name</label>
                                                    <input
                                                        type="text"
                                                        value={displayName}
                                                        onChange={(e) => setDisplayName(e.target.value)}
                                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                                                        placeholder="e.g. Ghost_Operator"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">System Email</label>
                                                    <div className="relative">
                                                        <AtSign size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/30" />
                                                        <input
                                                            type="email"
                                                            defaultValue={user?.email || ""}
                                                            disabled
                                                            className="w-full bg-white/2 border border-white/5 rounded-xl py-3 pl-11 pr-4 text-sm font-mono opacity-40 cursor-not-allowed"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">Node Description / Bio</label>
                                                <textarea
                                                    rows={3}
                                                    value={bio}
                                                    onChange={(e) => setBio(e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all resize-none"
                                                    placeholder="Brief protocol status or operator info..."
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">Base Location</label>
                                                    <div className="relative">
                                                        <Globe size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/30" />
                                                        <input
                                                            type="text"
                                                            value={location}
                                                            onChange={(e) => setLocation(e.target.value)}
                                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-mono focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                                                            placeholder="e.g. Accra, GH"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">External Port (Website)</label>
                                                    <div className="relative">
                                                        <Globe size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/30" />
                                                        <input
                                                            type="text"
                                                            value={website}
                                                            onChange={(e) => setWebsite(e.target.value)}
                                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-mono focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                                                            placeholder="https://yourpage.com"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>

                                    {/* Capabilities Card */}
                                    <motion.div variants={itemVariants} className="glass-card overflow-hidden">
                                        <div className="p-6 border-b border-white/5 bg-white/5 flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                                <Briefcase size={18} />
                                            </div>
                                            <h2 className="font-black font-mono uppercase text-xs tracking-[0.2em]">Operational Skills</h2>
                                        </div>
                                        <div className="p-8 space-y-6">
                                            <div className="space-y-4">
                                                <div className="flex flex-wrap gap-2">
                                                    {skills.map(skill => (
                                                        <span key={skill} className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-lg text-[10px] font-black font-mono uppercase border border-primary/20 group">
                                                            {skill}
                                                            <button onClick={() => removeSkill(skill)} className="hover:text-rose-500 transition-colors">
                                                                <X size={12} />
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={newSkill}
                                                        onChange={(e) => setNewSkill(e.target.value)}
                                                        onKeyDown={(e) => e.key === 'Enter' && addSkill()}
                                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:border-primary/50 outline-none"
                                                        placeholder="Add protocol tag..."
                                                    />
                                                    <button onClick={addSkill} className="p-3 bg-primary text-primary-foreground rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:scale-105 active:scale-95 transition-all">
                                                        <Plus size={20} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                {[
                                                    { id: 'twitter', icon: Twitter, value: socialLinks.twitter },
                                                    { id: 'github', icon: Github, value: socialLinks.github },
                                                    { id: 'linkedin', icon: Linkedin, value: socialLinks.linkedin },
                                                ].map((social) => {
                                                    const Icon = social.icon;
                                                    return (
                                                        <div key={social.id} className="relative">
                                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1 rounded-md bg-white/5">
                                                                <Icon size={14} className="text-muted-foreground" />
                                                            </div>
                                                            <input
                                                                type="text"
                                                                value={social.value}
                                                                onChange={(e) => setSocialLinks({ ...socialLinks, [social.id]: e.target.value })}
                                                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-[11px] font-mono focus:border-primary/50 outline-none"
                                                                placeholder={`${social.id} ID`}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </motion.div>

                                    {/* Action Buttons */}
                                    <motion.div variants={itemVariants} className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 glass-card border-primary/20 bg-primary/5">
                                        <div className="flex items-center gap-4 text-primary">
                                            <div className="p-3 bg-primary/20 rounded-2xl">
                                                <ShieldCheck size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black font-mono text-[10px] uppercase tracking-[0.2em]">Protocol Verification</p>
                                                <p className="text-[10px] font-mono opacity-60 uppercase">System encryption: ACTIVE</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="w-full md:w-auto flex items-center justify-center gap-3 bg-primary text-primary-foreground font-black font-mono py-4 px-10 rounded-2xl shadow-[0_10px_30px_rgba(16,185,129,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                            {saving ? "UPLOADING..." : "COMMIT CHANGES"}
                                        </button>
                                    </motion.div>

                                    {/* Danger Zone */}
                                    <motion.div variants={itemVariants} className="glass-card border-rose-500/20 bg-rose-500/2 overflow-hidden">
                                        <div className="p-6 border-b border-rose-500/10 flex items-center justify-between">
                                            <div className="flex items-center gap-3 text-rose-500">
                                                <AlertTriangle size={18} />
                                                <h3 className="font-black font-mono uppercase text-xs tracking-[0.2em]">Terminal Termination</h3>
                                            </div>
                                            <button className="text-[10px] font-black font-mono text-rose-500 hover:bg-rose-500 hover:text-white border border-rose-500/20 py-2 px-6 rounded-xl transition-all uppercase tracking-widest">
                                                Delete All
                                            </button>
                                        </div>
                                    </motion.div>
                                </>
                            )}

                            {activeTab === "Notifications" && (
                                <motion.div variants={itemVariants} className="glass-card overflow-hidden">
                                    <div className="p-6 border-b border-white/5 bg-white/5 flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                            <Bell size={18} />
                                        </div>
                                        <h2 className="font-black font-mono uppercase text-xs tracking-[0.2em]">Transmission Filters</h2>
                                    </div>
                                    <div className="p-8 space-y-4">
                                        {[
                                            { id: "email_security", title: "Security Protocols", desc: "Critical alerts for auth & node breaches." },
                                            { id: "email_marketing", title: "Protocol Updates", desc: "New feature logs & network status." },
                                            { id: "push_nodes", title: "Runtime Diagnostics", desc: "Node health & shared bandwidth reports." },
                                        ].map((opt) => (
                                            <div key={opt.id} className="flex items-center justify-between p-5 bg-white/2 border border-white/5 rounded-2xl hover:border-primary/20 transition-all">
                                                <div className="space-y-1">
                                                    <p className="font-black font-mono text-xs uppercase tracking-wider">{opt.title}</p>
                                                    <p className="text-[9px] font-mono text-muted-foreground uppercase opacity-40">{opt.desc}</p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer group">
                                                    <input type="checkbox" className="sr-only peer" defaultChecked={opt.id === "email_security"} />
                                                    <div className="w-12 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary shadow-inner"></div>
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                            {activeTab === "Security" && (
                                <div className="space-y-6">
                                    <motion.div variants={itemVariants} className="glass-card">
                                        <div className="p-6 border-b border-white/5 bg-white/5 flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                                <Key size={18} />
                                            </div>
                                            <h2 className="font-black font-mono uppercase text-xs tracking-[0.2em]">Access Credentials</h2>
                                        </div>
                                        <div className="p-8 space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">Current Secret</label>
                                                <input type="password" placeholder="••••••••" className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:border-primary/50 outline-none transition-all" />
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">New Secret Token</label>
                                                    <input type="password" placeholder="••••••••" className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:border-primary/50 outline-none transition-all" />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black font-mono uppercase tracking-[0.1em] text-muted-foreground/60">Confirm Token</label>
                                                    <input type="password" placeholder="••••••••" className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm font-mono focus:border-primary/50 outline-none transition-all" />
                                                </div>
                                            </div>
                                            <div className="flex justify-end pt-4">
                                                <button className="flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 py-3 px-8 rounded-xl font-mono text-[10px] font-black uppercase tracking-widest transition-all">
                                                    Update Identity Keys
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>

                                    <motion.div variants={itemVariants} className="glass-card p-8 border-primary/20 bg-primary/2">
                                        <div className="flex items-center justify-between gap-6">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-primary/20 rounded-2xl text-primary">
                                                    <Lock size={24} />
                                                </div>
                                                <div>
                                                    <p className="font-black font-mono text-sm uppercase tracking-tight">2FA MULTI-LAYER AUTH</p>
                                                    <p className="text-[10px] font-mono text-muted-foreground uppercase">Status: <span className="text-rose-500 font-black">Offline</span></p>
                                                </div>
                                            </div>
                                            <button className="bg-primary text-primary-foreground font-black font-mono py-3 px-8 rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-all text-xs uppercase">
                                                Activate
                                            </button>
                                        </div>
                                    </motion.div>
                                </div>
                            )}

                            {activeTab === "Devices" && (
                                <motion.div variants={itemVariants} className="glass-card">
                                    <div className="p-6 border-b border-white/5 bg-white/5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                                <Monitor size={18} />
                                            </div>
                                            <h2 className="font-black font-mono uppercase text-xs tracking-[0.2em]">Active Terminals</h2>
                                        </div>
                                        <button className="text-[10px] font-black font-mono text-rose-500 hover:underline uppercase tracking-widest flex items-center gap-2">
                                            <LogOut size={12} />
                                            Revoke All
                                        </button>
                                    </div>
                                    <div className="p-8 space-y-4">
                                        {[
                                            { id: "1", name: "Windows PC - Chrome", loc: "Ghana, GH", ip: "102.176.4.55", active: true },
                                            { id: "2", name: "MacBook Pro - Terminal", loc: "Ghana, GH", ip: "192.168.1.10", active: false },
                                        ].map((device) => (
                                            <div key={device.id} className="flex items-center justify-between p-5 bg-white/2 border border-white/5 rounded-2xl group transition-all">
                                                <div className="flex items-center gap-4">
                                                    <div className="p-3 bg-white/5 rounded-xl group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                                        {device.name.includes("PC") ? <Monitor size={20} /> : <Smartphone size={20} />}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-3">
                                                            <p className="font-black font-mono text-[11px] uppercase">{device.name}</p>
                                                            {device.active && (
                                                                <span className="bg-emerald-500/10 text-emerald-500 text-[8px] px-2 py-0.5 rounded-full font-black font-mono uppercase border border-emerald-500/20">Active Now</span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] font-mono text-muted-foreground uppercase mt-1">IP: {device.ip} • Loc: {device.loc}</p>
                                                    </div>
                                                </div>
                                                {!device.active && (
                                                    <button className="text-[10px] font-black font-mono text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest">
                                                        Revoke
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
