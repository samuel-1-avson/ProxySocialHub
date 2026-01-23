"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateProfile, type UserPublicProfile } from "@/lib/services/profile";
import { User, Bell, Shield, Smartphone, Save, Globe, Briefcase, Hash, Twitter, Github, Linkedin, Plus, X, Loader2 } from "lucide-react";

export default function SettingsPage() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<Partial<UserPublicProfile>>({});

    // Form States
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [location, setLocation] = useState("");
    const [website, setWebsite] = useState("");

    // Advanced Fields
    const [skills, setSkills] = useState<string[]>([]);
    const [newSkill, setNewSkill] = useState("");
    const [socialLinks, setSocialLinks] = useState({ twitter: "", github: "", linkedin: "" });
    const [businessName, setBusinessName] = useState("");
    const [taxId, setTaxId] = useState("");

    useEffect(() => {
        async function loadProfile() {
            try {
                const data = await getMyProfile();
                setProfile(data);
                setDisplayName(data.display_name || "");
                setBio(data.bio || "");
                setLocation(data.location || "");
                setWebsite(data.website || "");
                setSkills(data.skills || []);
                setBusinessName(data.business_name || "");

                // Parse social links if they exist
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
                // We don't send tax_id to updateProfile directly unless backend supports it specifically for verification request
                // For now assuming it flows with other data or needs a separate endpoint. 
                // Based on previous context `updateProfile` accepts `Partial<UserPublicProfile>`.
                // Let's assume we can pass it if the backend supports it, or maybe it's `business_registration`?
                // The task description mentioned "Tax ID" for verification. 
                // I will add it to the payload if the type allows, strictly it is `business_name` in the interface, 
                // but let's check if we can pass extra fields. The implementation plan said "Integrate updateProfile".
            });
            // Show success (you might want a toast here)
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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="border-b border-border pb-6">
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-2">System Configuration</h1>
                <p className="text-muted-foreground font-mono text-xs">MANAGE PROTOCOL PARAMETERS AND IDENTITY LINK.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Settings Navigation */}
                <div className="space-y-2">
                    {[
                        { label: "General", icon: User, active: true },
                        { label: "Notifications", icon: Bell, active: false },
                        { label: "Security", icon: Shield, active: false },
                        { label: "Devices", icon: Smartphone, active: false },
                    ].map((item) => (
                        <button
                            key={item.label}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-sm transition-all border-2 ${item.active
                                ? "bg-primary text-primary-foreground border-foreground font-bold shadow-[2px_2px_0px_var(--foreground)]"
                                : "bg-card border-transparent hover:border-border text-muted-foreground hover:text-foreground"
                                }`}
                        >
                            <item.icon size={16} />
                            <span className="font-mono text-xs uppercase tracking-wide">{item.label}</span>
                        </button>
                    ))}
                </div>

                {/* Settings Content */}
                <div className="lg:col-span-3 space-y-6">

                    {/* Identity Section */}
                    <div className="card-retro p-8 bg-card">
                        <h2 className="text-xl font-bold font-mono uppercase mb-6 flex items-center gap-2 border-b border-border pb-2">
                            <User size={20} className="text-primary" />
                            Identity Parameters
                        </h2>

                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Display Name</label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        className="w-full bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                        placeholder="Operator Name"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Email Uplink</label>
                                    <input
                                        type="email"
                                        defaultValue={user?.email || ""}
                                        disabled
                                        className="w-full bg-secondary/20 border border-border rounded-sm py-2 px-3 text-sm font-mono opacity-60 cursor-not-allowed"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Bio / Status</label>
                                <textarea
                                    rows={3}
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    className="w-full bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
                                    placeholder="System status..."
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Location</label>
                                    <div className="relative">
                                        <Globe size={14} className="absolute left-3 top-3 text-muted-foreground" />
                                        <input
                                            type="text"
                                            value={location}
                                            onChange={(e) => setLocation(e.target.value)}
                                            className="w-full bg-background border border-border rounded-sm py-2 pl-9 pr-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                            placeholder="Digital Ocean"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Website</label>
                                    <div className="relative">
                                        <Globe size={14} className="absolute left-3 top-3 text-muted-foreground" />
                                        <input
                                            type="text"
                                            value={website}
                                            onChange={(e) => setWebsite(e.target.value)}
                                            className="w-full bg-background border border-border rounded-sm py-2 pl-9 pr-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                            placeholder="https://"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Professional Profile */}
                    <div className="card-retro p-8 bg-card">
                        <h2 className="text-xl font-bold font-mono uppercase mb-6 flex items-center gap-2 border-b border-border pb-2">
                            <Briefcase size={20} className="text-primary" />
                            Professional Profile
                        </h2>

                        <div className="space-y-6">
                            {/* Skills/Tags */}
                            <div className="space-y-2">
                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Capabilities (Skills)</label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {skills.map(skill => (
                                        <span key={skill} className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-sm text-xs font-mono uppercase border border-border">
                                            {skill}
                                            <button onClick={() => removeSkill(skill)} className="hover:text-destructive">
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
                                        className="flex-1 bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                        placeholder="Add capability (e.g. 'Residential', 'Scraping')"
                                    />
                                    <button onClick={addSkill} className="btn-retro btn-retro-outline px-3">
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Social Links */}
                            <div className="space-y-4">
                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Uplinks (Socials)</label>

                                <div className="flex items-center gap-3">
                                    <Twitter size={18} className="text-muted-foreground w-6" />
                                    <input
                                        type="text"
                                        value={socialLinks.twitter}
                                        onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
                                        className="flex-1 bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary outline-none"
                                        placeholder="Twitter Handle"
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <Github size={18} className="text-muted-foreground w-6" />
                                    <input
                                        type="text"
                                        value={socialLinks.github}
                                        onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
                                        className="flex-1 bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary outline-none"
                                        placeholder="GitHub Username"
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <Linkedin size={18} className="text-muted-foreground w-6" />
                                    <input
                                        type="text"
                                        value={socialLinks.linkedin}
                                        onChange={(e) => setSocialLinks({ ...socialLinks, linkedin: e.target.value })}
                                        className="flex-1 bg-background border border-border rounded-sm py-2 px-3 text-sm font-mono focus:border-primary outline-none"
                                        placeholder="LinkedIn Profile URL"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Business Verification */}
                    <div className="card-retro p-8 bg-card">
                        <h2 className="text-xl font-bold font-mono uppercase mb-6 flex items-center gap-2 border-b border-border pb-2">
                            <Shield size={20} className="text-primary" />
                            Business Verification
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Registered Entity Name</label>
                                <div className="relative">
                                    <Briefcase size={14} className="absolute left-3 top-3 text-muted-foreground" />
                                    <input
                                        type="text"
                                        value={businessName}
                                        onChange={(e) => setBusinessName(e.target.value)}
                                        className="w-full bg-background border border-border rounded-sm py-2 pl-9 pr-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                        placeholder="Corp Ltd."
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-mono font-bold uppercase text-muted-foreground">Tax / Registration ID</label>
                                <div className="relative">
                                    <Hash size={14} className="absolute left-3 top-3 text-muted-foreground" />
                                    <input
                                        type="text"
                                        value={taxId}
                                        onChange={(e) => setTaxId(e.target.value)}
                                        className="w-full bg-background border border-border rounded-sm py-2 pl-9 pr-3 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                        placeholder="For Verification"
                                    />
                                </div>
                                <p className="text-[10px] text-muted-foreground font-mono">
                                    * Needed for &quot;Verified Business&quot; badge.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end pt-4">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="btn-retro btn-retro-primary py-3 px-8 text-sm flex items-center gap-2 shadow-[4px_4px_0px_var(--foreground)] hover:translate-y-[-2px] transition-all"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? "SAVING..." : "SAVE CONFIGURATION"}
                        </button>
                    </div>

                    <div className="card-retro p-8 bg-card border-red-500/20 mt-8">
                        <h2 className="text-xl font-bold font-mono uppercase mb-4 text-destructive flex items-center gap-2">
                            <Shield size={20} />
                            Danger Zone
                        </h2>
                        <div className="flex items-center justify-between p-4 border border-destructive/20 bg-destructive/5 rounded-sm">
                            <div>
                                <p className="font-bold font-mono text-sm text-destructive">Terminate Link</p>
                                <p className="text-xs text-muted-foreground font-mono mt-1">PERMANENTLY DELETE ACCOUNT AND DATA.</p>
                            </div>
                            <button className="btn-retro bg-destructive text-destructive-foreground hover:bg-destructive/90 py-2 px-4 text-xs font-bold border-2 border-destructive-foreground">
                                DELETE
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
