'use client';

import { useState, useEffect } from 'react';
import { getMyProfile, updateProfile, UserPublicProfile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { User, MapPin, Link as LinkIcon, Calendar, Edit2, Users, Star, Shield, Activity, Save, History } from 'lucide-react';

export default function IdentitySettingsPage() {
    const { isAuthenticated } = useAuth();
    const [profile, setProfile] = useState<UserPublicProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<UserPublicProfile>>({});
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'profile' | 'activity'>('profile');

    useEffect(() => {
        if (!isAuthenticated) return;
        loadProfile();
    }, [isAuthenticated]);

    const loadProfile = async () => {
        try {
            const data = await getMyProfile();
            setProfile(data);
            setEditForm(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!editForm.username) return;
        setSaving(true);
        try {
            const updated = await updateProfile(editForm);
            setProfile(updated);
            setIsEditing(false);
        } catch (err) {
            console.error('Profile update failed:', err);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">Syncing Cryptographic Identity...</p>
        </div>
    );
    
    if (!profile) return null;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Content */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
                <div className="flex items-center gap-6">
                    <div className="relative group">
                        <div className="w-24 h-24 rounded-sm border border-white/10 bg-secondary/80 flex items-center justify-center overflow-hidden shadow-2xl relative">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
                            ) : (
                                <User size={40} className="text-muted-foreground/40" />
                            )}
                            {isEditing && (
                                <div className="absolute inset-0 bg-primary/20 backdrop-blur-[2px] flex items-center justify-center border border-primary/50">
                                    <span className="text-[8px] font-black font-mono text-white text-center px-2">OVERRIDE</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div>
                        <h2 className="text-2xl font-black font-mono uppercase tracking-tighter flex items-center gap-2">
                            {profile.display_name || 'Anonymous Entity'}
                            {profile.verified && <Shield size={16} className="text-primary" />}
                        </h2>
                        <div className="flex items-center gap-3 text-primary font-mono text-xs font-bold mt-1">
                            <span>@{profile.username || 'unknown'}</span>
                            <span className="w-1 h-1 rounded-full bg-white/20" />
                            <span className="text-muted-foreground uppercase opacity-60">
                                Trust Tier: {profile.trust_tier}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    {!isEditing ? (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="btn-retro font-black text-[9px] tracking-[0.2em] px-5 py-2.5 flex items-center gap-2 border-primary/20 hover:border-primary transition-all group"
                        >
                            <Edit2 size={12} className="group-hover:rotate-12 transition-transform" /> 
                            MODIFY IDENTITY
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={() => setIsEditing(false)}
                                className="px-4 py-2 border border-white/10 rounded-sm text-[9px] font-black font-mono uppercase tracking-widest hover:bg-white/5 transition-colors"
                            >
                                Abort
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="bg-primary text-primary-foreground px-5 py-2.5 rounded-sm text-[9px] font-black font-mono uppercase tracking-[0.2em] shadow-[3px_3px_0px_rgba(var(--primary),0.3)] hover:translate-y-[-1px] hover:translate-x-[-1px] transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving ? <Activity size={12} className="animate-spin" /> : <Save size={12} />}
                                {saving ? 'SYNCING...' : 'COMMIT'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Inner Tabs */}
            <div className="flex border-b border-white/5">
                <button
                    onClick={() => setActiveTab('profile')}
                    className={`px-4 py-2 font-mono text-[10px] uppercase font-black tracking-widest border-b-2 transition-all ${
                        activeTab === 'profile' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Profile Parameters
                </button>
                <button
                    onClick={() => setActiveTab('activity')}
                    className={`px-4 py-2 font-mono text-[10px] uppercase font-black tracking-widest border-b-2 transition-all ${
                        activeTab === 'activity' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Activity Log
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4">
                {activeTab === 'profile' ? (
                    <>
                        <div className="lg:col-span-2 space-y-6">
                            {isEditing ? (
                                <div className="space-y-6 p-6 bg-white/[0.02] border border-white/5 rounded-sm animate-in slide-in-from-left-4 duration-500">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Display Label</label>
                                            <input
                                                type="text"
                                                value={editForm.display_name || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, display_name: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none transition-all uppercase"
                                                placeholder="ENTER NAME..."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Operational Sector</label>
                                            <input
                                                type="text"
                                                value={editForm.location || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, location: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none transition-all uppercase"
                                                placeholder="GLOBAL / REMOTE..."
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Mission Profile (Bio)</label>
                                        <textarea
                                            value={editForm.bio || ''}
                                            onChange={e => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                                            className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono h-24 focus:border-primary outline-none transition-all resize-none"
                                            placeholder="DESCRIBE YOUR SYSTEM PARAMETERS..."
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">External Node (Website)</label>
                                            <input
                                                type="text"
                                                value={editForm.website || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, website: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none transition-all"
                                                placeholder="HTTPS://..."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">System Role Title</label>
                                            <input
                                                type="text"
                                                value={editForm.professional_title || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, professional_title: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none transition-all uppercase"
                                                placeholder="E.G. NETWORK ARCHITECT..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-8">
                                    <div className="p-8 bg-white/[0.02] border border-white/5 rounded-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 -mr-16 -mt-16 rounded-full blur-3xl" />
                                        <h3 className="text-[9px] font-black font-mono text-primary uppercase tracking-[0.4em] mb-4 opacity-60 italic underline underline-offset-4 decoration-primary/30">Identity Overview</h3>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium text-foreground/90">
                                            {profile.bio || 'Public mission profile not yet defined for this entity.'}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-white/[0.01] border border-white/5 p-4 rounded-sm flex items-center gap-4 group hover:bg-white/[0.03] transition-all">
                                            <div className="p-2.5 rounded-sm bg-primary/10 border border-primary/20 text-primary group-hover:scale-110 transition-transform">
                                                <MapPin size={16} />
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Operational Sector</p>
                                                <p className="text-[11px] font-bold font-mono uppercase tracking-tight">{profile.location || 'GLOBAL'}</p>
                                            </div>
                                        </div>
                                        <div className="bg-white/[0.01] border border-white/5 p-4 rounded-sm flex items-center gap-4 group hover:bg-white/[0.03] transition-all">
                                            <div className="p-2.5 rounded-sm bg-secondary/10 border border-secondary/20 text-secondary group-hover:scale-110 transition-transform">
                                                <Calendar size={16} />
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Registry Date</p>
                                                <p className="text-[11px] font-bold font-mono uppercase tracking-tight">
                                                    {profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-6">
                            <div className="p-6 bg-white/[0.01] border border-white/5 rounded-sm">
                                <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] mb-4 opacity-40">Reputation Level</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-2">
                                            <Star size={12} className="text-amber-400" fill="currentColor" />
                                            <span className="text-muted-foreground/60 uppercase">Rating Index</span>
                                        </div>
                                        <span className="font-bold">{Number(profile.avg_rating ?? 0).toFixed(1)} <span className="text-[9px] opacity-40">({profile.reviews_count} REVIEWS)</span></span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-2">
                                            <Activity size={12} className="text-primary" />
                                            <span className="text-muted-foreground/60 uppercase">Traffic Score</span>
                                        </div>
                                        <span className="font-bold uppercase">{(profile.total_bandwidth_sold).toFixed(2)} GB</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-2">
                                            <Users size={12} className="text-secondary" />
                                            <span className="text-muted-foreground/60 uppercase">Reach</span>
                                        </div>
                                        <span className="font-bold uppercase">{profile.followers_count} FOLLOWER(S)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="lg:col-span-3 space-y-4">
                        <div className="p-4 bg-white/[0.01] border border-white/5 rounded-sm flex items-center gap-4 animate-in slide-in-from-left-4 duration-500">
                            <div className="p-3 rounded-full bg-primary/10 text-primary">
                                <History size={16} />
                            </div>
                            <div>
                                <p className="text-[11px] font-bold font-mono uppercase tracking-tight">System Registry Initialized</p>
                                <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">
                                    {profile.created_at ? new Date(profile.created_at).toLocaleString() : 'N/A'}
                                </p>
                            </div>
                        </div>

                        <div className="bg-white/[0.02] border border-white/5 rounded-sm p-12 text-center text-muted-foreground font-mono space-y-4">
                            <div className="w-12 h-12 rounded-full border border-white/5 flex items-center justify-center mx-auto opacity-20">
                                <Activity size={24} />
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] uppercase tracking-[0.2em] font-black">Archive Synchronization Complete</p>
                                <p className="text-[8px] opacity-40 max-w-sm mx-auto uppercase">PROTOCOL EVENTS AND BADGE AWARDS WILL BE LOGGED HERE IN REAL-TIME AS THEY ARE COMMITTED TO THE LEDGER.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
