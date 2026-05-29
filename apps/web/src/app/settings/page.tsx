"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateProfile, deleteAccount } from "@/lib/services/profile";
import { useWallet } from "@solana/wallet-adapter-react";
import { signDeleteAccountMessage } from "@/lib/solana-message-sign";
import { getErrorMessage } from "@/lib/utils";
import Link from "next/link";
import {
    User, Bell, Shield, Smartphone, Save, Globe,
    Briefcase, Twitter, Github, Linkedin,
    Plus, X, Loader2, Key, Monitor, Lock,
    AlertTriangle, LogOut, ArrowLeft,
    AtSign, ShieldCheck, Zap, Mail, Layout,
    MapPin, Wifi, Copy, Check, Trash2, QrCode
} from "lucide-react";
import { 
    getMFAStatus, setupMFA, verifyMFA, disableMFA, 
    listAPIKeys, createAPIKey, revokeAPIKey, 
    getSessions, revokeSession, revokeAllSessions,
    getBackupCodesCount, regenerateBackupCodes,
    type APIKey, type UserSession, type MFAStatus, type MFASetup 
} from "@/lib/services/security";
import {
    getNotificationPreferences,
    updateNotificationPreferences,
    type NotificationPreference
} from "@/lib/notifications-api";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QRCodeSVG } from 'qrcode.react';

type Tab = "General" | "Notifications" | "Security" | "Devices";

export default function SettingsPage() {
    const { user, logout } = useAuth();
    const { signMessage, publicKey, connected } = useWallet();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("General");

    // Notification State
    const [notifPrefs, setNotifPrefs] = useState<NotificationPreference | null>(null);
    const [notifSaving, setNotifSaving] = useState(false);

    // 2FA Backup Codes & Disable States
    const [backupCodesCount, setBackupCodesCount] = useState<number>(0);
    const [backupCodes, setBackupCodes] = useState<string[]>([]);
    const [showBackupCodesModal, setShowBackupCodesModal] = useState(false);
    const [showDisableMfaModal, setShowDisableMfaModal] = useState(false);
    const [disableMfaCode, setDisableMfaCode] = useState("");
    const [isDisablingMfa, setIsDisablingMfa] = useState(false);
    const [copiedCodes, setCopiedCodes] = useState(false);

    // Delete Account States
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    // Profile State
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [location, setLocation] = useState("");
    const [isp, setIsp] = useState("");
    const [website, setWebsite] = useState("");
    const [skills, setSkills] = useState<string[]>([]);
    const [newSkill, setNewSkill] = useState("");
    const [socialLinks, setSocialLinks] = useState({ twitter: "", github: "", linkedin: "" });

    // Professional State
    const [professionalTitle, setProfessionalTitle] = useState("");
    const [experienceYears, setExperienceYears] = useState(0);
    const [languages, setLanguages] = useState<string[]>([]);
    const [newLanguage, setNewLanguage] = useState("");
    const [primarySpecialization, setPrimarySpecialization] = useState("");
    const [businessName, setBusinessName] = useState("");
    const [taxId, setTaxId] = useState("");

    // Security & Device State
    const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
    const [newKeyName, setNewKeyName] = useState("");
    const [createdKey, setCreatedKey] = useState<string | null>(null);
    const [sessions, setSessions] = useState<UserSession[]>([]);
    const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
    const [mfaSetupData, setMfaSetupData] = useState<MFASetup | null>(null);
    const [mfaCode, setMfaCode] = useState("");
    const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);

    // Load Profile
    useEffect(() => {
        async function loadProfile() {
            try {
                const data = await getMyProfile();
                setDisplayName(data.display_name || "");
                setBio(data.bio || "");
                setLocation(data.location || "");
                setIsp(data.isp || "");
                setWebsite(data.website || "");
                setSkills(data.skills || []);
                setProfessionalTitle(data.professional_title || "");
                setExperienceYears(data.experience_years || 0);
                setLanguages(data.languages || []);
                setPrimarySpecialization(data.primary_specialization || "");
                setBusinessName(data.business_name || "");
                setTaxId(data.tax_id || ""); // Note: tax_id might not be in UserPublicProfile DTO if masked
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
    }, [user, activeTab]);

    async function loadSecurityData() {
        try {
            const [status, keys] = await Promise.all([getMFAStatus(), listAPIKeys()]);
            setMfaStatus(status);
            setApiKeys(keys);
            if (status.enabled) {
                const codesStatus = await getBackupCodesCount();
                setBackupCodesCount(codesStatus.remaining_codes);
            }
        } catch (err) {
            console.error("Failed to load security data", err);
        }
    }

    async function loadNotificationPrefs() {
        try {
            const prefs = await getNotificationPreferences();
            setNotifPrefs(prefs);
        } catch (err) {
            console.error("Failed to load notification preferences", err);
        }
    }

    async function loadSessionData() {
        try {
            const data = await getSessions();
            setSessions(data);
        } catch (err) {
            console.error("Failed to load sessions", err);
        }
    }

    // Load Security Data when tab changes
    useEffect(() => {
        if (activeTab === "Security") {
            loadSecurityData();
        } else if (activeTab === "Devices") {
            loadSessionData();
        } else if (activeTab === "Notifications") {
            loadNotificationPrefs();
        }
    }, [activeTab]);
    // Security Handlers
    const handleCreateKey = async () => {
        if (!newKeyName) return;
        try {
            const { api_key, ...keyData } = await createAPIKey(newKeyName);
            setCreatedKey(api_key);
            setApiKeys([keyData as any, ...apiKeys]);
            setNewKeyName("");
        } catch (err) {
            console.error("Failed to create key", err);
        }
    };

    const handleRevokeKey = async (id: string) => {
        try {
            await revokeAPIKey(id);
            setApiKeys(apiKeys.filter(k => k.id !== id));
        } catch (err) {
            console.error("Failed to revoke key", err);
        }
    };

    const handleStartMfaSetup = async () => {
        try {
            const data = await setupMFA();
            setMfaSetupData(data);
        } catch (err) {
            console.error("Failed to start MFA setup", err);
        }
    };

    const handleVerifyMfa = async () => {
        if (!mfaCode) return;
        setIsVerifyingMfa(true);
        try {
            const res = await verifyMFA(mfaCode);
            setMfaStatus({ enabled: true, verified_at: new Date().toISOString() });
            setMfaSetupData(null);
            setMfaCode("");
            if (res.backup_codes && res.backup_codes.length > 0) {
                setBackupCodes(res.backup_codes);
                setBackupCodesCount(res.backup_codes.length);
                setShowBackupCodesModal(true);
            }
        } catch (err) {
            console.error("MFA Verification failed", err);
        } finally {
            setIsVerifyingMfa(false);
        }
    };

    const handleDisableMfa = async () => {
        if (!disableMfaCode) return;
        setIsDisablingMfa(true);
        try {
            await disableMFA(disableMfaCode);
            setMfaStatus({ enabled: false, verified_at: undefined });
            setShowDisableMfaModal(false);
            setDisableMfaCode("");
            setBackupCodesCount(0);
        } catch (err) {
            console.error("Failed to disable MFA", err);
        } finally {
            setIsDisablingMfa(false);
        }
    };

    const handleRegenerateBackupCodes = async () => {
        try {
            const res = await regenerateBackupCodes();
            if (res.backup_codes && res.backup_codes.length > 0) {
                setBackupCodes(res.backup_codes);
                setBackupCodesCount(res.backup_codes.length);
                setShowBackupCodesModal(true);
            }
        } catch (err) {
            console.error("Failed to regenerate backup codes", err);
        }
    };

    const handleCopyBackupCodes = () => {
        navigator.clipboard.writeText(backupCodes.join("\n"));
        setCopiedCodes(true);
        setTimeout(() => setCopiedCodes(false), 2000);
    };

    const handleNotifToggle = async (
        category: "social" | "business" | "community" | "system",
        channel: "in_app" | "email" | "push"
    ) => {
        if (!notifPrefs || notifSaving) return;

        const key = `${category}_${channel}` as keyof NotificationPreference;
        const newValue = !notifPrefs[key];

        const updatedPrefs = { ...notifPrefs, [key]: newValue };
        setNotifPrefs(updatedPrefs);

        try {
            setNotifSaving(true);
            await updateNotificationPreferences({ [key]: newValue });
        } catch (err) {
            console.error("Failed to save preferences", err);
            // Revert on error
            setNotifPrefs(notifPrefs);
        } finally {
            setNotifSaving(false);
        }
    };

    const handleDigestChange = async (field: string, value: string | number) => {
        if (!notifPrefs || notifSaving) return;

        const updatedPrefs = { ...notifPrefs, [field]: value };
        setNotifPrefs(updatedPrefs);

        try {
            setNotifSaving(true);
            await updateNotificationPreferences({ [field]: value });
        } catch (err) {
            console.error("Failed to save preferences", err);
            // Revert
            setNotifPrefs(notifPrefs);
        } finally {
            setNotifSaving(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (deleteConfirmationText !== "DELETE MY ACCOUNT") return;
        setDeletingAccount(true);
        setDeleteError("");
        try {
            let nonce: string | undefined;
            let signature: string | undefined;

            if (user?.wallet_address) {
                if (!signMessage || !connected || !publicKey) {
                    setDeleteError("Connect the Solana wallet linked to your account to sign the deletion request.");
                    return;
                }
                if (publicKey.toBase58() !== user.wallet_address) {
                    setDeleteError("Connected wallet does not match your linked account address.");
                    return;
                }
                const signed = await signDeleteAccountMessage(signMessage);
                nonce = signed.nonce;
                signature = signed.signature;
            }

            await deleteAccount("DELETE MY ACCOUNT", { nonce, signature });
            setShowDeleteModal(false);
            await logout();
            window.location.href = "/";
        } catch (err) {
            setDeleteError(getErrorMessage(err) || "Failed to schedule account deletion");
        } finally {
            setDeletingAccount(false);
        }
    };

    const handleRevokeSession = async (id: string) => {
        try {
            await revokeSession(id);
            setSessions(sessions.filter(s => s.id !== id));
        } catch (err) {
            console.error("Failed to revoke session", err);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateProfile({
                display_name: displayName,
                bio,
                website,
                skills,
                social_links: socialLinks,
                professional_title: professionalTitle,
                experience_years: experienceYears,
                languages: languages,
                primary_specialization: primarySpecialization,
                business_name: businessName,
                tax_id: taxId,
            });
            // Reload profile to get backend-detected location/isp
            const updated = await getMyProfile();
            setLocation(updated.location || "");
            setIsp(updated.isp || "");
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

    const addLanguage = () => {
        if (newLanguage && !languages.includes(newLanguage)) {
            setLanguages([...languages, newLanguage]);
            setNewLanguage("");
        }
    };

    const removeLanguage = (lang: string) => {
        setLanguages(languages.filter(l => l !== lang));
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
        hidden: { opacity: 0, x: 20 },
        show: {
            opacity: 1,
            x: 0,
            transition: { 
                staggerChildren: 0.1,
                duration: 0.4,
                ease: "easeOut"
            }
        }
    } as const;

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <div className="space-y-14">
            {/* Header Section */}
            <div className="relative group">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
                        <div className="flex items-center gap-4 mb-3">
                            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                                <Layout size={28} />
                            </div>
                            <h1 className="text-5xl font-black font-sans uppercase italic tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-white/80 to-emerald-500">
                                Protocol Settings
                            </h1>
                        </div>
                        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.4em] uppercase opacity-60 pl-20">
                            SYSTEM CONFIGURATION & IDENTITY PARAMETERS
                        </p>
                    </motion.div>
                </div>
                
                {/* Decorative background glow */}
                <div className="absolute -top-32 -left-32 w-80 h-80 bg-emerald-500/10 blur-[140px] pointer-events-none rounded-full" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
                {/* Navigation Sidebar */}
                <div className="space-y-3">
                    <p className="px-4 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/40 mb-2">Navigation</p>
                    {tabs.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "group relative w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 overflow-hidden border",
                                activeTab === item.id
                                    ? "bg-emerald-500/10 border-emerald-500/40 text-white shadow-[0_0_30px_rgba(16,185,129,0.15)]"
                                    : "bg-white/[0.03] border-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground hover:bg-white/5"
                            )}
                        >
                            {/* Active Lamp Effect */}
                            {activeTab === item.id && (
                                <motion.div 
                                    layoutId="activeTabGlow"
                                    className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-transparent pointer-events-none" 
                                />
                            )}
                            
                            <div className={cn(
                                "p-2.5 rounded-xl transition-all duration-300 z-10",
                                activeTab === item.id ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-muted-foreground group-hover:text-emerald-400"
                            )}>
                                <item.icon size={20} />
                            </div>
                            
                            <div className="text-left z-10 transition-transform group-hover:translate-x-1 duration-300">
                                <span className={cn(
                                    "block font-mono text-[11px] font-black uppercase tracking-wider",
                                    activeTab === item.id ? "text-white" : "text-muted-foreground"
                                )}>{item.label}</span>
                                <span className="block text-[9px] font-mono uppercase opacity-40 mt-0.5">{item.desc}</span>
                            </div>

                            {activeTab === item.id && (
                                <motion.div 
                                    layoutId="activeIndicator"
                                    className="absolute right-0 h-8 w-1 bg-emerald-500 rounded-l-full shadow-[0_0_15px_rgba(16,185,129,1)]" 
                                />
                            )}
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
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-8"
                        >
                            {activeTab === "General" && (
                                <>
                                    {/* Core Identity */}
                                    <GlassCard className="p-0 border-white/10 overflow-hidden">
                                        <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
                                                    <User size={20} />
                                                </div>
                                                <div>
                                                    <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Core Identity</h2>
                                                    <p className="text-[10px] font-mono text-muted-foreground/60 uppercase">Doxxed or Anonymized Parameters</p>
                                                </div>
                                            </div>
                                            <ShieldCheck size={16} className="text-emerald-500/40" />
                                        </div>
                                        
                                        <div className="p-10 space-y-10">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        <AtSign size={12} className="text-emerald-500" />
                                                        Operator Name
                                                    </label>
                                                    <Input
                                                        value={displayName}
                                                        onChange={(e) => setDisplayName(e.target.value)}
                                                        className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30 focus:border-emerald-500/50 transition-all"
                                                        placeholder="e.g. Ghost_Operator"
                                                    />
                                                </div>
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        <Mail size={12} className="text-purple-500" />
                                                        System Email
                                                    </label>
                                                    <Input
                                                        defaultValue={user?.email || ""}
                                                        disabled
                                                        className="h-14 bg-white/[0.02] border-white/5 rounded-2xl font-mono opacity-50 cursor-not-allowed text-xs"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                    <Zap size={12} className="text-amber-500" />
                                                    Node Description / Bio
                                                </label>
                                                <textarea
                                                    rows={4}
                                                    value={bio}
                                                    onChange={(e) => setBio(e.target.value)}
                                                    className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-sm font-mono focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 outline-none transition-all resize-none shadow-inner"
                                                    placeholder="Brief protocol status or operator info..."
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                <div className="space-y-3 relative group/field">
                                                    <label className="flex items-center justify-between text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        <div className="flex items-center gap-2">
                                                            <MapPin size={12} className="text-blue-500" />
                                                            Base Location
                                                        </div>
                                                        <span className="flex items-center gap-1 text-[8px] text-emerald-400/60 lowercase italic bg-emerald-500/5 px-2 py-0.5 rounded-full border border-emerald-500/10">
                                                            <ShieldCheck size={8} /> auto-detected
                                                        </span>
                                                    </label>
                                                    <div className="relative">
                                                        <Input
                                                            value={location}
                                                            readOnly
                                                            className="h-14 bg-black/40 border-white/5 rounded-2xl font-mono text-muted-foreground/60 cursor-default"
                                                            placeholder="Detecting protocol position..."
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-3 relative group/field">
                                                    <label className="flex items-center justify-between text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        <div className="flex items-center gap-2">
                                                            <Wifi size={12} className="text-emerald-500" />
                                                            Network Provider (ISP)
                                                        </div>
                                                        <span className="flex items-center gap-1 text-[8px] text-emerald-400/60 lowercase italic bg-emerald-500/5 px-2 py-0.5 rounded-full border border-emerald-500/10">
                                                            <ShieldCheck size={8} /> auto-detected
                                                        </span>
                                                    </label>
                                                    <div className="relative">
                                                        <Input
                                                            value={isp}
                                                            readOnly
                                                            className="h-14 bg-black/40 border-white/5 rounded-2xl font-mono text-muted-foreground/60 cursor-default"
                                                            placeholder="Analyzing carrier signal..."
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                    <Globe size={12} className="text-pink-500" />
                                                    External Port (Website)
                                                </label>
                                                <Input
                                                    value={website}
                                                    onChange={(e) => setWebsite(e.target.value)}
                                                    className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30 transition-all text-sm"
                                                    placeholder="https://yourpage.com"
                                                />
                                            </div>
                                        </div>
                                    </GlassCard>

                                    {/* Operational Credentials & Skills */}
                                    <GlassCard className="p-0 border-white/10 overflow-hidden">
                                        <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                                                <Briefcase size={20} />
                                            </div>
                                            <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Professional Identity</h2>
                                        </div>
                                        <div className="p-10 space-y-10">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        Professional Title
                                                    </label>
                                                    <Input
                                                        value={professionalTitle}
                                                        onChange={(e) => setProfessionalTitle(e.target.value)}
                                                        className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30"
                                                        placeholder="e.g. Senior Security Engineer"
                                                    />
                                                </div>
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        Experience (Years)
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        value={experienceYears}
                                                        onChange={(e) => setExperienceYears(parseInt(e.target.value) || 0)}
                                                        className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        Specialization
                                                    </label>
                                                    <Input
                                                        value={primarySpecialization}
                                                        onChange={(e) => setPrimarySpecialization(e.target.value)}
                                                        className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30"
                                                        placeholder="e.g. Distributed Systems"
                                                    />
                                                </div>
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        Languages
                                                    </label>
                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                        {languages.map(lang => (
                                                            <span key={lang} className="bg-white/5 border border-white/10 px-3 py-1 rounded-lg text-[9px] font-mono flex items-center gap-2">
                                                                {lang}
                                                                <button onClick={() => removeLanguage(lang)}><X size={10} /></button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            value={newLanguage}
                                                            onChange={(e) => setNewLanguage(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && addLanguage()}
                                                            className="h-10 bg-black/40 border-white/10 rounded-xl font-mono text-xs"
                                                            placeholder="Add language..."
                                                        />
                                                        <button onClick={addLanguage} className="p-2 bg-white/5 rounded-xl border border-white/10 hover:bg-emerald-500/20"><Plus size={16} /></button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </GlassCard>

                                    {/* Business Profile (Optional) */}
                                    <GlassCard className="p-0 border-white/10 overflow-hidden">
                                        <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
                                                <Shield size={20} />
                                            </div>
                                            <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Business Profile</h2>
                                        </div>
                                        <div className="p-10 space-y-10">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        Registered Entity Name
                                                    </label>
                                                    <Input
                                                        value={businessName}
                                                        onChange={(e) => setBusinessName(e.target.value)}
                                                        className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30"
                                                        placeholder="Company Ltd."
                                                    />
                                                </div>
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                                                        Tax ID / Registration Number
                                                    </label>
                                                    <Input
                                                        value={taxId}
                                                        onChange={(e) => setTaxId(e.target.value)}
                                                        className="h-14 bg-black/40 border-white/10 rounded-2xl font-mono focus:ring-emerald-500/30"
                                                        placeholder="Required for higher tiers"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </GlassCard>

                                    {/* Operational Skills */}
                                    <GlassCard className="p-0 border-white/10 overflow-hidden">
                                        <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                                                <Zap size={20} />
                                            </div>
                                            <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Operational Skills</h2>
                                        </div>
                                        <div className="p-10 space-y-8">
                                            <div className="space-y-4">
                                                <div className="flex flex-wrap gap-2.5">
                                                    {skills.map(skill => (
                                                        <span key={skill} className="flex items-center gap-3 bg-white/5 hover:bg-emerald-500/10 text-white/90 px-4 py-2 rounded-xl text-[10px] font-black font-mono uppercase border border-white/10 hover:border-emerald-500/30 transition-all group">
                                                            {skill}
                                                            <button onClick={() => removeSkill(skill)} className="text-muted-foreground hover:text-rose-500 transition-colors">
                                                                <X size={14} />
                                                            </button>
                                                        </span>
                                                    ))}
                                                    {skills.length === 0 && <p className="text-xs text-muted-foreground italic opacity-40 uppercase font-mono tracking-widest">No tags defined...</p>}
                                                </div>
                                                <div className="flex gap-3">
                                                    <Input
                                                        value={newSkill}
                                                        onChange={(e) => setNewSkill(e.target.value)}
                                                        onKeyDown={(e) => e.key === 'Enter' && addSkill()}
                                                        className="flex-1 h-12 bg-black/40 border-white/10 rounded-xl font-mono text-xs"
                                                        placeholder="Add protocol tag..."
                                                    />
                                                    <button onClick={addSkill} className="p-3 bg-white/5 hover:bg-emerald-500 text-white rounded-xl border border-white/10 transition-all group">
                                                        <Plus size={20} className="group-hover:rotate-90 transition-transform duration-300" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                                                {[
                                                    { id: 'twitter', icon: Twitter, value: socialLinks.twitter, color: 'text-blue-400' },
                                                    { id: 'github', icon: Github, value: socialLinks.github, color: 'text-white' },
                                                    { id: 'linkedin', icon: Linkedin, value: socialLinks.linkedin, color: 'text-blue-600' },
                                                ].map((social) => (
                                                    <div key={social.id} className="relative group/social">
                                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-white/5 group-hover/social:bg-white/10 transition-colors">
                                                            <social.icon size={14} className={cn("transition-all", social.color)} />
                                                        </div>
                                                        <Input
                                                            value={social.value}
                                                            onChange={(e) => setSocialLinks({ ...socialLinks, [social.id]: e.target.value })}
                                                            className="h-12 bg-black/40 border-white/10 rounded-xl pl-14 font-mono text-[10px]"
                                                            placeholder={`${social.id.toUpperCase()} HANDLE`}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </GlassCard>

                                    {/* Action Bar */}
                                    <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-10 glass-card border-emerald-500/20 bg-emerald-500/5 rounded-3xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:rotate-12 transition-transform duration-1000">
                                            <ShieldCheck size={120} />
                                        </div>
                                        <div className="flex items-center gap-6 relative z-10">
                                            <div className="p-4 bg-emerald-500/20 rounded-2xl text-emerald-400 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
                                                <ShieldCheck size={32} />
                                            </div>
                                            <div>
                                                <p className="font-black font-sans italic text-lg uppercase tracking-tight">Sync Protocol State</p>
                                                <p className="text-[10px] font-mono text-emerald-500/60 uppercase tracking-widest mt-1">Status: READY FOR UPLOAD • Encryption: v3.2 ACTIVE</p>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="w-full md:w-auto h-16 px-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black font-sans italic uppercase tracking-widest text-lg shadow-[0_10px_40px_rgba(16,185,129,0.3)] transition-all relative z-10"
                                        >
                                            {saving ? <Loader2 size={24} className="animate-spin mr-3" /> : <Save size={24} className="mr-3" />}
                                            {saving ? "SYNCING..." : "COMMIT CHANGES"}
                                        </Button>
                                    </div>

                                    {/* Danger Zone */}
                                    <GlassCard className="border-rose-500/20 bg-rose-500/5 p-8 rounded-3xl">
                                        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                                            <div className="flex items-center gap-4 text-rose-500">
                                                <div className="p-3 bg-rose-500/10 rounded-2xl">
                                                    <AlertTriangle size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-black font-sans italic uppercase text-sm tracking-tight">Terminal Termination</h3>
                                                    <p className="text-[10px] font-mono text-rose-500/60 uppercase">DANGEROUS: Wipes all local nodes and active credentials</p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    setDeleteConfirmationText("");
                                                    setShowDeleteModal(true);
                                                }}
                                                className="h-12 px-8 rounded-xl border border-rose-500/30 text-[10px] font-black font-mono text-rose-500 hover:bg-rose-500 hover:text-white transition-all uppercase tracking-widest"
                                            >
                                                Self-Destruct
                                            </button>
                                        </div>
                                    </GlassCard>
                                </>
                            )}
                            {activeTab === "Notifications" && (
                                <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                    <GlassCard className="p-0 border-white/10 overflow-hidden">
                                         <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                                                <Bell size={20} />
                                            </div>
                                            <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Transmission Filters</h2>
                                        </div>
                                        <div className="p-8 space-y-6">
                                            {notifPrefs ? (
                                                ([
                                                    { id: "social", label: "Social Notifications", desc: "Follows, messages, mentions, and friend requests.", icon: User, color: 'text-blue-400' },
                                                    { id: "business", label: "Business Activity", desc: "Orders, payments, and listing activity.", icon: Briefcase, color: 'text-amber-400' },
                                                    { id: "community", label: "Community Interactions", desc: "Replies, upvotes, badges, and forum activity.", icon: Globe, color: 'text-purple-400' },
                                                    { id: "system", label: "Security & System Alerts", desc: "Security alerts, maintenance, and account updates.", icon: Lock, color: 'text-rose-400' },
                                                ] as const).map((category) => (
                                                    <div key={category.id} className="p-6 bg-black/40 border border-white/5 rounded-2xl space-y-4">
                                                        <div className="flex items-start gap-4">
                                                            <div className={cn("p-2.5 rounded-xl bg-white/5", category.color)}>
                                                                <category.icon size={20} />
                                                            </div>
                                                            <div>
                                                                <p className="font-black font-mono text-xs uppercase tracking-wider">{category.label}</p>
                                                                <p className="text-[10px] font-mono text-muted-foreground uppercase opacity-60 mt-1">{category.desc}</p>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                                                            {[
                                                                { id: "in_app", label: "In-App", icon: Monitor },
                                                                { id: "email", label: "Email", icon: Mail },
                                                                { id: "push", label: "Push", icon: Smartphone },
                                                            ].map((channel) => {
                                                                const prefKey = `${category.id}_${channel.id}` as keyof NotificationPreference;
                                                                const isEnabled = notifPrefs[prefKey] as boolean;
                                                                return (
                                                                    <div key={channel.id} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                                                                        <div className="flex items-center gap-2">
                                                                            <channel.icon size={14} className={isEnabled ? "text-emerald-400" : "text-muted-foreground"} />
                                                                            <span className="text-[10px] font-mono uppercase tracking-wider font-bold">{channel.label}</span>
                                                                        </div>
                                                                        <label className="relative inline-flex items-center cursor-pointer group/toggle">
                                                                            <input
                                                                                type="checkbox"
                                                                                className="sr-only peer"
                                                                                checked={isEnabled}
                                                                                onChange={() => handleNotifToggle(category.id, channel.id as any)}
                                                                            />
                                                                            <div className="w-10 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[20px] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 shadow-xl border border-white/5"></div>
                                                                        </label>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="flex justify-center py-10">
                                                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                                </div>
                                            )}
                                        </div>
                                    </GlassCard>

                                    {notifPrefs && (
                                        <GlassCard className="p-0 border-white/10 overflow-hidden">
                                            <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center gap-3">
                                                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
                                                    <Mail size={20} />
                                                </div>
                                                <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Email Digest Frequency</h2>
                                            </div>
                                            <div className="p-8 space-y-6">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                    <div className="space-y-3">
                                                        <label className="text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">Frequency Option</label>
                                                        <select
                                                            value={notifPrefs.email_digest_frequency}
                                                            onChange={(e) => handleDigestChange("email_digest_frequency", e.target.value)}
                                                            className="w-full h-14 bg-black/40 border border-white/10 rounded-2xl px-5 text-sm font-mono focus:border-emerald-500/50 outline-none text-white appearance-none cursor-pointer"
                                                        >
                                                            <option value="immediate">Immediate Delivery</option>
                                                            <option value="hourly">Hourly Summary</option>
                                                            <option value="daily">Daily Digest Summary</option>
                                                        </select>
                                                    </div>

                                                    {notifPrefs.email_digest_frequency === "daily" && (
                                                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                                                            <div className="space-y-3">
                                                                <label className="text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">Digest Day</label>
                                                                <select
                                                                    value={notifPrefs.digest_day}
                                                                    onChange={(e) => handleDigestChange("digest_day", e.target.value)}
                                                                    className="w-full h-14 bg-black/40 border border-white/10 rounded-2xl px-5 text-sm font-mono focus:border-emerald-500/50 outline-none text-white"
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
                                                            <div className="space-y-3">
                                                                <label className="text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">Digest Hour</label>
                                                                <select
                                                                    value={notifPrefs.digest_hour}
                                                                    onChange={(e) => handleDigestChange("digest_hour", parseInt(e.target.value))}
                                                                    className="w-full h-14 bg-black/40 border border-white/10 rounded-2xl px-5 text-sm font-mono focus:border-emerald-500/50 outline-none text-white"
                                                                >
                                                                    {Array.from({ length: 24 }, (_, i) => (
                                                                        <option key={i} value={i}>
                                                                            {i.toString().padStart(2, "0")}:00 UTC
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </GlassCard>
                                    )}
                                </div>
                            )}

                            {activeTab === "Security" && (
                                <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                    {/* Identity Tokens Management */}
                                    <GlassCard className="p-0 border-white/10 overflow-hidden">
                                        <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                                                    <Key size={20} />
                                                </div>
                                                <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Identity Session Tokens</h2>
                                            </div>
                                            <div className="text-[10px] font-mono text-emerald-500/60 uppercase tracking-widest hidden md:block">
                                                Active Keys: {apiKeys.length} / 10
                                            </div>
                                        </div>
                                        
                                        <div className="p-10 space-y-8">
                                            <p className="text-[11px] font-mono text-muted-foreground uppercase leading-relaxed max-w-2xl">
                                                Use Identity Tokens for automated nodes, AI agents, or CLI access. These tokens provide secure, limited-scope access to your protocol resources without needing a wallet signature for every heartbeat.
                                            </p>

                                            {/* Key Creation */}
                                            <div className="flex gap-4 p-4 rounded-2xl bg-black/40 border border-white/5">
                                                <Input 
                                                    value={newKeyName}
                                                    onChange={(e) => setNewKeyName(e.target.value)}
                                                    placeholder="NAME YOUR TOKEN (e.g. EDGE_NODE_01)" 
                                                    className="h-12 bg-transparent border-none font-mono text-xs uppercase focus:ring-0" 
                                                />
                                                <Button 
                                                    onClick={handleCreateKey}
                                                    disabled={!newKeyName}
                                                    className="h-12 px-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black font-mono text-[10px] uppercase tracking-widest"
                                                >
                                                    Generate Token
                                                </Button>
                                            </div>

                                            {/* Plaintext Key Reveal */}
                                            {createdKey && (
                                                <motion.div 
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-4"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-[10px] font-black font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                                                            <ShieldCheck size={14} /> Critical Security Key Generated
                                                        </p>
                                                        <button 
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(createdKey);
                                                                setCopiedKey(true);
                                                                setTimeout(() => setCopiedKey(false), 2000);
                                                            }}
                                                            className="text-emerald-400 hover:text-emerald-300 flex items-center gap-2 text-[10px] font-mono"
                                                        >
                                                            {copiedKey ? <Check size={14} /> : <Copy size={14} />} {copiedKey ? "COPIED" : "COPY KEY"}
                                                        </button>
                                                    </div>
                                                    <div className="p-4 bg-black/60 rounded-xl font-mono text-sm text-emerald-500 break-all border border-emerald-500/20">
                                                        {createdKey}
                                                    </div>
                                                    <p className="text-[9px] font-mono text-emerald-500/60 uppercase">
                                                        Warning: This key will never be shown again. Store it in a secure vault immediately.
                                                    </p>
                                                    <Button variant="ghost" className="text-[9px] text-white/40 hover:text-white uppercase font-mono" onClick={() => setCreatedKey(null)}>Dismiss</Button>
                                                </motion.div>
                                            )}

                                            {/* Key List */}
                                            <div className="space-y-4">
                                                {apiKeys.map(key => (
                                                    <div key={key.id} className="flex items-center justify-between p-5 bg-white/2 border border-white/5 rounded-2xl hover:border-white/10 transition-all">
                                                        <div className="flex items-center gap-6">
                                                            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40">
                                                                <AtSign size={18} />
                                                            </div>
                                                            <div>
                                                                <p className="font-black font-mono text-xs uppercase tracking-tight text-white/80">{key.name}</p>
                                                                <p className="text-[9px] font-mono text-muted-foreground mt-1 uppercase opacity-60">
                                                                    Prefix: {key.prefix} • Last Used: {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'NEVER'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => handleRevokeKey(key.id)}
                                                            className="p-3 text-rose-500/40 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                                {apiKeys.length === 0 && (
                                                    <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl opacity-20">
                                                        <p className="text-[10px] font-mono uppercase tracking-widest">No Active Identity Tokens</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </GlassCard>

                                    {/* MFA Protocol Layer */}
                                    <div className="p-10 glass-card border-blue-500/20 bg-blue-500/5 rounded-3xl relative overflow-hidden group">
                                         <div className="absolute -right-10 -bottom-10 p-10 opacity-[0.05] group-hover:rotate-12 transition-transform duration-1000">
                                            <QrCode size={200} />
                                        </div>
                                        
                                        <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
                                            <div className="flex items-center gap-6">
                                                <div className="p-4 bg-blue-500/20 rounded-2xl text-blue-400 border border-blue-500/20 shadow-lg">
                                                    <Lock size={32} />
                                                </div>
                                                <div>
                                                    <p className="font-black font-sans italic text-lg uppercase tracking-tight">2FA MULTI-LAYER AUTH</p>
                                                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1">
                                                        Identity Shielding (TOTP) • Status: 
                                                        {mfaStatus?.enabled ? (
                                                            <span className="text-emerald-500 font-black ml-2 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">PROTECTED</span>
                                                        ) : (
                                                            <span className="text-rose-500 font-black ml-2">UNPROTECTED</span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            {!mfaStatus?.enabled && !mfaSetupData && (
                                                <Button 
                                                    onClick={handleStartMfaSetup}
                                                    className="w-full md:w-auto h-14 px-12 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black font-sans italic uppercase tracking-widest shadow-xl"
                                                >
                                                    Activate Shield
                                                </Button>
                                            )}
                                        </div>

                                        {mfaStatus?.enabled && (
                                            <div className="mt-8 pt-8 border-t border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10 animate-in fade-in duration-300">
                                                <div>
                                                    <p className="font-black font-mono text-xs uppercase tracking-wider text-white">Shield Active & Secure</p>
                                                    <p className="text-[10px] font-mono text-muted-foreground uppercase opacity-60 mt-1">
                                                        Backup codes remaining: <span className="text-emerald-400 font-black font-mono">{backupCodesCount}</span>
                                                    </p>
                                                </div>
                                                <div className="flex gap-4 w-full md:w-auto">
                                                    <Button
                                                        onClick={handleRegenerateBackupCodes}
                                                        className="flex-1 md:flex-none h-12 px-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                                                    >
                                                        Regenerate codes
                                                    </Button>
                                                    <Button
                                                        onClick={() => {
                                                            setDisableMfaCode("");
                                                            setShowDisableMfaModal(true);
                                                        }}
                                                        className="flex-1 md:flex-none h-12 px-6 rounded-xl bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-400 font-black font-mono text-[10px] uppercase tracking-widest"
                                                    >
                                                        Disable 2FA
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        {/* MFA Setup Flow */}
                                        {mfaSetupData && (
                                            <motion.div 
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="mt-10 p-8 rounded-3xl bg-black/40 border border-blue-500/20 flex flex-col md:flex-row gap-10 items-center relative z-10"
                                            >
                                                <div className="w-40 h-40 bg-white p-3 rounded-2xl flex items-center justify-center">
                                                    <QRCodeSVG value={mfaSetupData.qr_code_url} size={136} className="w-full h-full" />
                                                </div>
                                                <div className="flex-1 space-y-6">
                                                    <p className="text-[11px] font-mono text-blue-400 uppercase tracking-widest font-black">Scan with Google Authenticator or Authy</p>
                                                    <div className="flex gap-4">
                                                        <Input 
                                                            value={mfaCode}
                                                            onChange={(e) => setMfaCode(e.target.value)}
                                                            placeholder="ENTER 6-DIGIT CODE" 
                                                            className="h-14 bg-black/60 border-blue-500/30 rounded-xl text-center font-mono text-xl tracking-[0.5em] focus:ring-blue-500/30"
                                                            maxLength={6}
                                                        />
                                                        <Button 
                                                            onClick={handleVerifyMfa}
                                                            disabled={mfaCode.length !== 6 || isVerifyingMfa}
                                                            className="h-14 px-10 bg-blue-500 hover:bg-blue-400 rounded-xl"
                                                        >
                                                            {isVerifyingMfa ? <Loader2 className="animate-spin" /> : <ShieldCheck size={24} />}
                                                        </Button>
                                                    </div>
                                                    <p className="text-[9px] font-mono text-white/40 uppercase">Secret Key: {mfaSetupData.secret}</p>
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === "Devices" && (
                                <GlassCard className="p-0 border-white/10 overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
                                    <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-pink-500/10 text-pink-400">
                                                <Monitor size={20} />
                                            </div>
                                            <h2 className="font-black font-sans italic uppercase text-sm tracking-tight">Active Terminals</h2>
                                        </div>
                                        <button 
                                            onClick={() => revokeAllSessions().then(() => setSessions([]))}
                                            className="text-[10px] font-black font-mono text-rose-500 hover:text-rose-400 underline uppercase tracking-widest flex items-center gap-2 transition-colors"
                                        >
                                            <LogOut size={14} />
                                            Revoke All
                                        </button>
                                    </div>
                                    <div className="p-8 space-y-4">
                                        {sessions.map((session) => (
                                            <div key={session.id} className="flex items-center justify-between p-6 bg-black/40 border border-white/5 rounded-2xl group transition-all hover:bg-black/60 shadow-inner">
                                                <div className="flex items-center gap-6">
                                                    <div className="p-3.5 bg-white/5 rounded-2xl group-hover:bg-emerald-500/10 group-hover:text-emerald-400 transition-all duration-300">
                                                        {session.device_type === "mobile" ? <Smartphone size={24} /> : <Monitor size={24} />}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-3">
                                                            <p className="font-black font-mono text-[11px] uppercase tracking-wider">{session.device_type} • {session.browser}</p>
                                                            <span className="bg-emerald-500/20 text-emerald-400 text-[9px] px-3 py-1 rounded-lg font-black font-mono uppercase border border-emerald-500/20">Active</span>
                                                        </div>
                                                        <p className="text-[10px] font-mono text-muted-foreground uppercase mt-1 tracking-widest opacity-40 italic">
                                                            IP: {session.ip_address} • OS: {session.os} • Last Pulse: {new Date(session.last_active_at).toLocaleTimeString()}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={() => handleRevokeSession(session.id)}
                                                    className="text-[10px] font-black font-mono text-rose-500 opacity-0 group-hover:opacity-100 transition-all hover:scale-110 uppercase tracking-widest"
                                                >
                                                    Kill
                                                </button>
                                            </div>
                                        ))}
                                        {sessions.length === 0 && (
                                            <div className="py-20 text-center opacity-20">
                                                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                                                <p className="text-[10px] font-mono uppercase tracking-widest">Synchronizing Session Data...</p>
                                            </div>
                                        )}
                                    </div>
                                </GlassCard>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

            {/* 2FA Backup Codes Modal */}
            {showBackupCodesModal && backupCodes.length > 0 && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-neutral-950 w-full max-w-md border border-white/10 p-8 rounded-3xl space-y-6 shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                            <h3 className="text-lg font-black font-mono uppercase tracking-tight text-white flex items-center gap-2">
                                <Key className="text-emerald-400" size={20} /> Backup Codes
                            </h3>
                            <button 
                                onClick={() => { setShowBackupCodesModal(false); setBackupCodes([]); }}
                                className="text-muted-foreground hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex gap-3 text-amber-500 text-[10px] font-mono uppercase font-black">
                            <AlertTriangle size={16} className="shrink-0" />
                            <span>Save these recovery codes immediately. They are single-use only.</span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            {backupCodes.map((code, index) => (
                                <div key={index} className="p-3 bg-black/60 border border-white/5 rounded-xl font-mono text-sm text-center text-emerald-400 tracking-wider">
                                    {code}
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-4 pt-2">
                            <Button
                                onClick={handleCopyBackupCodes}
                                className="flex-1 h-12 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                {copiedCodes ? "COPIED" : "COPY CODES"}
                            </Button>
                            <Button
                                onClick={() => { setShowBackupCodesModal(false); setBackupCodes([]); }}
                                className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                ACKNOWLEDGED
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Disable MFA Modal */}
            {showDisableMfaModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-neutral-950 w-full max-w-md border border-rose-500/20 p-8 rounded-3xl space-y-6 shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                            <h3 className="text-lg font-black font-mono uppercase tracking-tight text-rose-500 flex items-center gap-2">
                                <AlertTriangle size={20} /> Deactivate Shield
                            </h3>
                            <button 
                                onClick={() => setShowDisableMfaModal(false)}
                                className="text-muted-foreground hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <label className="block text-[10px] font-black font-mono uppercase tracking-wider text-muted-foreground">Enter 2FA Code to Confirm</label>
                            <Input
                                value={disableMfaCode}
                                onChange={(e) => setDisableMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="000 000"
                                className="h-14 bg-black/60 border-rose-500/30 rounded-xl text-center font-mono text-xl tracking-[0.5em] focus:ring-rose-500/20 focus:border-rose-500/50"
                                maxLength={6}
                            />
                        </div>

                        <div className="flex gap-4 pt-2">
                            <Button
                                onClick={() => setShowDisableMfaModal(false)}
                                className="flex-1 h-12 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDisableMfa}
                                disabled={disableMfaCode.length !== 6 || isDisablingMfa}
                                className="flex-1 h-12 bg-rose-600 hover:bg-rose-500 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                {isDisablingMfa ? "DEACTIVATING..." : "CONFIRM DISABLE"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Account Deletion (Self-Destruct) Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-neutral-950 w-full max-w-md border border-rose-500/30 p-8 rounded-3xl space-y-6 shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-white/5">
                            <h3 className="text-lg font-black font-mono uppercase tracking-tight text-rose-500 flex items-center gap-2">
                                <AlertTriangle size={20} /> Terminal Termination
                            </h3>
                            <button 
                                onClick={() => setShowDeleteModal(false)}
                                className="text-muted-foreground hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex gap-3 text-rose-500 text-[10px] font-mono uppercase font-black">
                            <AlertTriangle size={16} className="shrink-0" />
                            <span>This action deletes all active node configurations, wallet credentials, and schedules profile deletion.</span>
                        </div>

                        {user?.wallet_address && (
                            <p className="text-[10px] font-mono text-muted-foreground uppercase">
                                A wallet signature is required. Connect Phantom (or your linked wallet) before confirming.
                            </p>
                        )}

                        {deleteError && (
                            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-[10px] font-mono rounded-xl">
                                {deleteError}
                            </div>
                        )}

                        <div className="space-y-4">
                            <label className="block text-[10px] font-black font-mono uppercase tracking-wider text-muted-foreground leading-relaxed">
                                Type <span className="text-rose-500 font-bold font-mono">DELETE MY ACCOUNT</span> below to confirm.
                            </label>
                            <Input
                                value={deleteConfirmationText}
                                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                                placeholder="DELETE MY ACCOUNT"
                                className="h-14 bg-black/60 border-rose-500/30 rounded-xl font-mono text-xs text-rose-500 focus:ring-rose-500/20 focus:border-rose-500/50"
                            />
                        </div>

                        <div className="flex gap-4 pt-2">
                            <Button
                                onClick={() => setShowDeleteModal(false)}
                                className="flex-1 h-12 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black font-mono text-[10px] uppercase tracking-widest"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDeleteAccount}
                                disabled={deleteConfirmationText !== "DELETE MY ACCOUNT" || deletingAccount}
                                className="flex-1 h-12 bg-rose-600 hover:bg-rose-500 text-white font-black font-mono text-[10px] uppercase tracking-widest shadow-[0_5px_20px_rgba(239,68,68,0.2)]"
                            >
                                {deletingAccount ? "TERMINATING..." : "CONFIRM TERMINATE"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
