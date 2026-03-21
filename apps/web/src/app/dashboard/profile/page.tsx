'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { getMyProfile, updateProfile, UserPublicProfile } from '@/lib/api';
import { User, MapPin, Link as LinkIcon, Calendar, Edit2, Users, Star, Shield, Activity, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function ProfilePage() {
    const { isAuthenticated, user: authUser } = useAuth();
    const router = useRouter();
    const [profile, setProfile] = useState<UserPublicProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<UserPublicProfile>>({});
    const [saving, setSaving] = useState(false);

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
            // Optionally add a success notification here
        } catch (err) {
            console.error('Profile update failed:', err);
            // Replacing alert with a more subtle error logging for now, 
            // but ensuring the user knows it failed via the saving state.
        } finally {
            setSaving(false);
        }
    };

    const getHostname = (url: string | undefined): string => {
        if (!url) return '';
        try {
            return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
        } catch {
            return url;
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-40 gap-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground animate-pulse">Aggregating Identity Metrics...</p>
        </div>
    );
    
    if (!profile) return (
        <div className="max-w-4xl mx-auto py-20">
            <div className="p-12 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/[0.02]">
                <Activity size={40} className="mx-auto text-muted-foreground/30 mb-4" />
                <p className="font-mono text-sm font-bold text-muted-foreground uppercase tracking-widest">Profile Identity Not Synchronized</p>
                <button 
                    onClick={() => window.location.reload()}
                    className="mt-4 text-[10px] font-black font-mono text-primary hover:underline uppercase"
                >
                    Attempt Re-sync
                </button>
            </div>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Cover Image */}
            <div className="h-48 md:h-64 rounded-t-2xl bg-gradient-to-r from-primary/10 via-secondary/5 to-primary/10 relative overflow-hidden border-b border-white/5 group/cover">
                {profile.cover_image_url ? (
                    <img src={profile.cover_image_url} alt="Cover" className="w-full h-full object-cover opacity-60 group-hover/cover:scale-105 transition-transform duration-1000" />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/5">
                        <Activity size={120} className="animate-pulse" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                {isEditing && (
                    <div className="absolute top-4 right-4 animate-in fade-in zoom-in duration-300">
                        <span className="bg-background/80 px-3 py-1.5 rounded-sm text-[9px] font-black font-mono backdrop-blur-md border border-white/10 text-primary shadow-2xl">
                            COVER OVERRIDE ACTIVE
                        </span>
                    </div>
                )}
            </div>

            {/* Profile Header */}
            <div className="relative px-6 pb-8 bg-card/50 backdrop-blur-xl border-x border-b border-white/5 rounded-b-2xl mb-8 shadow-2xl overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/50 via-secondary/50 to-primary/50 opacity-30" />
                
                <div className="flex flex-col md:flex-row items-start md:items-end gap-8 -mt-16 mb-8 relative z-10">
                    {/* Avatar */}
                    <div className="relative group/avatar">
                        <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl border-4 border-card bg-secondary/80 flex items-center justify-center overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-transform group-hover/avatar:scale-[1.02] duration-500">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
                            ) : (
                                <User size={64} className="text-muted-foreground/40" />
                            )}
                        </div>
                        {isEditing && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/20 backdrop-blur-[2px] rounded-2xl border-2 border-primary/50 animate-in fade-in duration-300">
                                <span className="text-white text-[10px] font-black font-mono tracking-tighter uppercase drop-shadow-lg text-center px-4">
                                    Identity Visual Override
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 space-y-3 pb-2">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div className="space-y-1">
                                <h1 className="text-3xl font-black font-mono uppercase tracking-tighter text-foreground flex items-center gap-3">
                                    {profile.display_name || 'Anonymous Entity'}
                                    {profile.verified && (
                                        <div className="bg-primary/10 p-1 rounded-sm border border-primary/20">
                                            <Shield size={20} className="text-primary" fill="currentColor" fillOpacity={0.2} />
                                        </div>
                                    )}
                                </h1>
                                <div className="flex items-center gap-2">
                                    <span className="text-primary font-mono text-sm font-bold">@{profile.username || 'unknown'}</span>
                                    <span className="w-1 h-1 rounded-full bg-white/20" />
                                    <span className="text-muted-foreground font-mono text-[10px] uppercase font-black tracking-widest opacity-60">
                                        Trust Tier: {profile.trust_tier || 'NEW'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {!isEditing ? (
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="btn-retro font-black text-[10px] tracking-[0.2em] px-6 py-3 flex items-center gap-3 border-primary/20 hover:border-primary transition-all group"
                                    >
                                        <Edit2 size={12} className="group-hover:rotate-12 transition-transform" /> 
                                        MODIFY IDENTITY
                                    </button>
                                ) : (
                                    <div className="flex gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <button
                                            onClick={() => setIsEditing(false)}
                                            className="px-4 py-2 border border-white/10 rounded-sm text-[10px] font-black font-mono uppercase tracking-widest hover:bg-white/5 transition-colors"
                                        >
                                            Abort
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="bg-primary text-primary-foreground px-6 py-2 rounded-sm text-[10px] font-black font-mono uppercase tracking-[0.2em] shadow-[4px_4px_0px_rgba(var(--primary),0.3)] hover:translate-y-[-2px] hover:translate-x-[-2px] hover:shadow-[6px_6px_0px_rgba(var(--primary),0.4)] transition-all disabled:opacity-50 disabled:translate-y-0 flex items-center gap-2"
                                        >
                                            {saving ? (
                                                <Activity size={12} className="animate-spin" />
                                            ) : (
                                                <Save size={12} />
                                            )}
                                            {saving ? 'SYNCING...' : 'COMMIT CHANGES'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Stats Strip */}
                        <div className="flex flex-wrap gap-8 items-center pt-4 border-t border-white/5 mt-6">
                            <div className="group/stat">
                                <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.3em] mb-1 opacity-40">Network reach</p>
                                <div className="flex items-center gap-2">
                                    <Users size={14} className="text-primary/60" />
                                    <span className="text-lg font-black font-mono">{(profile.followers_count ?? 0).toLocaleString()}</span>
                                    <span className="text-[10px] font-mono text-muted-foreground opacity-40 uppercase">Followers</span>
                                </div>
                            </div>
                            <div className="h-8 w-px bg-white/5" />
                            <div className="group/stat">
                                <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.3em] mb-1 opacity-40">Protocol Index</p>
                                <div className="flex items-center gap-2">
                                    <Activity size={14} className="text-primary/60" />
                                    <span className="text-lg font-black font-mono">{(profile.following_count ?? 0).toLocaleString()}</span>
                                    <span className="text-[10px] font-mono text-muted-foreground opacity-40 uppercase">Following</span>
                                </div>
                            </div>
                            <div className="h-8 w-px bg-white/5" />
                            <div className="group/stat">
                                <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.3em] mb-1 opacity-40">Reputation Level</p>
                                <div className="flex items-center gap-2">
                                    <Star size={14} className="text-amber-400/60" />
                                    <span className="text-lg font-black font-mono">{Number(profile.avg_rating ?? 0).toFixed(1)}</span>
                                    <span className="text-[10px] font-mono text-muted-foreground opacity-40 uppercase">Score ({(profile.reviews_count ?? 0)} REVIEWS)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4 relative z-10">
                    {/* Left Column: Details */}
                    <div className="lg:col-span-2 space-y-8">
                        {isEditing ? (
                            <div className="glass-card p-6 border-primary/10 animate-in slide-in-from-left-4 duration-500">
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Biological Identity (Name)</label>
                                            <input
                                                type="text"
                                                value={editForm.display_name || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, display_name: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all uppercase placeholder:opacity-20"
                                                placeholder="ENTER DISPLAY LABEL..."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Network Sector (Location)</label>
                                            <input
                                                type="text"
                                                value={editForm.location || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, location: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all uppercase placeholder:opacity-20"
                                                placeholder="GLOBAL / REMOTE..."
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Mission Profile (Bio)</label>
                                        <textarea
                                            value={editForm.bio || ''}
                                            onChange={e => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                                            className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono h-32 focus:border-primary outline-none transition-all placeholder:opacity-20 resize-none"
                                            placeholder="DESCRIBE YOUR SYSTEM PARAMETERS AND OBJECTIVES..."
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">External Node (Website)</label>
                                            <input
                                                type="text"
                                                value={editForm.website || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, website: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all placeholder:opacity-20"
                                                placeholder="HTTPS://..."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Professional Title</label>
                                            <input
                                                type="text"
                                                value={editForm.professional_title || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, professional_title: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all uppercase placeholder:opacity-20"
                                                placeholder="E.G. NETWORK ARCHITECT..."
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Avatar Resource (URL)</label>
                                            <input
                                                type="text"
                                                value={editForm.avatar_url || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, avatar_url: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Cover Backbone (URL)</label>
                                            <input
                                                type="text"
                                                value={editForm.cover_image_url || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, cover_image_url: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black font-mono uppercase text-primary/60 tracking-widest pl-1">Specializations (Comma Separated)</label>
                                        <input
                                            type="text"
                                            value={editForm.skills?.join(', ') || ''}
                                            onChange={e => setEditForm(prev => ({ ...prev, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                                            className="w-full bg-black/40 border border-white/10 p-3 rounded-sm text-xs font-mono focus:border-primary outline-none transition-all uppercase placeholder:opacity-20"
                                            placeholder="E.G. SOLANA, PROXY, SECURITY..."
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                <div className="glass-card p-8 border-white/5 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 -mr-16 -mt-16 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors" />
                                    <h3 className="text-xs font-black font-mono text-primary uppercase tracking-[0.4em] mb-4">Identity Overview</h3>
                                    <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap font-medium text-foreground/90">
                                        {profile.bio || 'Public mission profile not yet defined for this entity.'}
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl flex items-center gap-4 transition-colors hover:bg-white/[0.04]">
                                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]">
                                            <MapPin size={18} />
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Operational Sector</p>
                                            <p className="text-xs font-bold font-mono uppercase tracking-tight">{profile.location || 'GLOBAL'}</p>
                                        </div>
                                    </div>
                                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl flex items-center gap-4 transition-colors hover:bg-white/[0.04]">
                                        <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary border border-secondary/20">
                                            <Calendar size={18} />
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Registry Date</p>
                                            <p className="text-xs font-bold font-mono uppercase tracking-tight">
                                                {profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Meta Info */}
                    <div className="space-y-6">
                        {!isEditing && profile.website && (
                            <div className="glass-card p-6 border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent hover:border-primary/20 transition-all group">
                                <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] mb-4 opacity-40">System Link</h3>
                                <a 
                                    href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="flex items-center justify-between group-hover:text-primary transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <LinkIcon size={16} />
                                        <span className="text-xs font-bold font-mono tracking-tight truncate max-w-[150px]">
                                            {getHostname(profile.website)}
                                        </span>
                                    </div>
                                    <Edit2 size={12} className="opacity-0 group-hover:opacity-40 transition-opacity" />
                                </a>
                            </div>
                        )}

                        <div className="glass-card p-6 border-white/5 bg-white/[0.01]">
                            <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] mb-4 opacity-40">Network Status</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                    <span className="text-muted-foreground/60 uppercase">Protocol Role</span>
                                    <span className="font-bold uppercase text-primary">{profile.role || 'USER'}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                    <span className="text-muted-foreground/60 uppercase">Identity Status</span>
                                    <span className={profile.verified ? 'text-emerald-400 font-bold uppercase' : 'text-amber-400 font-bold uppercase'}>
                                        {profile.verified ? 'VERIFIED' : 'UNVERIFIED'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                    <span className="text-muted-foreground/60 uppercase">Trust level</span>
                                    <span className="font-bold uppercase tracking-widest">{profile.trust_tier || 'NEW'}</span>
                                </div>
                            </div>
                        </div>

                        {profile.skills && profile.skills.length > 0 && (
                            <div className="glass-card p-6 border-white/5 bg-white/[0.01]">
                                <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] mb-4 opacity-40">Specializations</h3>
                                <div className="flex flex-wrap gap-2">
                                    {profile.skills.map((skill, i) => (
                                        <span key={i} className="text-[9px] font-mono font-bold bg-white/5 border border-white/10 px-2 py-1 rounded-sm uppercase tracking-tighter hover:border-primary/40 transition-colors">
                                            {skill}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
