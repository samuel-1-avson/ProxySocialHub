'use client';

import { useState, useEffect, useRef } from 'react';
import { getMyProfile, updateProfile, UserPublicProfile, getUserActivity, type ActivityEvent } from '@/lib/api/profile';
import { accountTierLabel } from '@/lib/account-tier';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/stores';
import { getErrorMessage } from '@/lib/utils';
import { User, MapPin, Calendar, Edit2, Users, Star, Shield, Activity, Save, History, Camera } from 'lucide-react';

type IdentityDraft = {
    display_name: string;
    username: string;
    bio: string;
    location: string;
    website: string;
    avatar_url: string;
    professional_title: string;
};

function draftFromProfile(profile: UserPublicProfile): IdentityDraft {
    return {
        display_name: profile.display_name || '',
        username: profile.username || '',
        bio: profile.bio || '',
        location: profile.location || '',
        website: profile.website || '',
        avatar_url: profile.avatar_url || '',
        professional_title: profile.professional_title || '',
    };
}

async function fileToAvatarDataUrl(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
        throw new Error('Choose an image file');
    }
    if (file.size > 2_000_000) {
        throw new Error('Image must be under 2 MB before resize');
    }
    const bitmap = await createImageBitmap(file);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process image');
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    if (dataUrl.length > 80000) {
        throw new Error('Image is still too large after resize. Try a simpler photo.');
    }
    return dataUrl;
}

export default function IdentitySettingsPage() {
    const { isAuthenticated, refreshUser } = useAuth();
    const toast = useToast();
    const fileRef = useRef<HTMLInputElement>(null);
    const [profile, setProfile] = useState<UserPublicProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<IdentityDraft>({
        display_name: '',
        username: '',
        bio: '',
        location: '',
        website: '',
        avatar_url: '',
        professional_title: '',
    });
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'profile' | 'activity'>('profile');
    const [activity, setActivity] = useState<ActivityEvent[]>([]);
    const [activityLoading, setActivityLoading] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) return;
        loadProfile();
    }, [isAuthenticated]);

    useEffect(() => {
        if (!profile || activeTab !== 'activity') return;
        let cancelled = false;
        setActivityLoading(true);
        getUserActivity(profile.id)
            .then((events) => {
                if (!cancelled) setActivity(events);
            })
            .catch(() => {
                if (!cancelled) setActivity([]);
            })
            .finally(() => {
                if (!cancelled) setActivityLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [profile, activeTab]);

    const loadProfile = async () => {
        try {
            const data = await getMyProfile();
            setProfile(data);
            setEditForm(draftFromProfile(data));
        } catch (err) {
            toast.error(getErrorMessage(err) || 'Failed to load profile');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        const username = editForm.username.trim();
        if (!username) {
            toast.error('Username is required');
            return;
        }
        setSaving(true);
        try {
            const updated = await updateProfile({
                display_name: editForm.display_name.trim(),
                username,
                bio: editForm.bio,
                location: editForm.location.trim(),
                website: editForm.website.trim(),
                avatar_url: editForm.avatar_url.trim(),
                professional_title: editForm.professional_title.trim(),
            });
            setProfile(updated);
            setEditForm(draftFromProfile(updated));
            setIsEditing(false);
            await refreshUser();
            toast.success('Profile saved');
        } catch (err) {
            toast.error(getErrorMessage(err) || 'Failed to save profile');
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const dataUrl = await fileToAvatarDataUrl(file);
            setEditForm((prev) => ({ ...prev, avatar_url: dataUrl }));
            toast.success('Avatar ready — save to apply');
        } catch (err) {
            toast.error(getErrorMessage(err));
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">Loading profile...</p>
        </div>
    );
    
    if (!profile) return (
        <p className="font-mono text-sm text-muted-foreground">Could not load your profile.</p>
    );

    const avatarSrc = isEditing ? editForm.avatar_url : profile.avatar_url;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
                <div className="flex items-center gap-6">
                    <div className="relative group">
                        <div className="w-24 h-24 rounded-sm border border-white/10 bg-secondary/80 flex items-center justify-center overflow-hidden shadow-2xl relative">
                            {avatarSrc ? (
                                <img src={avatarSrc} alt={profile.display_name || profile.username} className="w-full h-full object-cover" />
                            ) : (
                                <User size={40} className="text-muted-foreground/40" />
                            )}
                            {isEditing && (
                                <button
                                    type="button"
                                    onClick={() => fileRef.current?.click()}
                                    className="absolute inset-0 bg-black/50 flex items-center justify-center border border-primary/50 text-white"
                                >
                                    <span className="text-[8px] font-black font-mono text-center px-2 flex items-center gap-1">
                                        <Camera size={12} /> PHOTO
                                    </span>
                                </button>
                            )}
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => void handleAvatarFile(e.target.files?.[0])}
                        />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black font-mono uppercase tracking-tighter flex items-center gap-2">
                            {profile.display_name || 'No display name'}
                            {profile.verified && <Shield size={16} className="text-primary" />}
                        </h2>
                        <div className="flex items-center gap-3 text-primary font-mono text-xs font-bold mt-1">
                            <span>@{profile.username || 'unknown'}</span>
                            <span className="w-1 h-1 rounded-full bg-white/20" />
                            <span className="text-muted-foreground uppercase opacity-60">
                                Account tier: {accountTierLabel(profile.trust_tier)}
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
                            Edit profile
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={() => {
                                    setEditForm(draftFromProfile(profile));
                                    setIsEditing(false);
                                }}
                                className="px-4 py-2 border border-white/10 rounded-sm text-[9px] font-black font-mono uppercase tracking-widest hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="bg-primary text-primary-foreground px-5 py-2.5 rounded-sm text-[9px] font-black font-mono uppercase tracking-[0.2em] hover:translate-y-[-1px] transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving ? <Activity size={12} className="animate-spin" /> : <Save size={12} />}
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex border-b border-white/5">
                <button
                    onClick={() => setActiveTab('profile')}
                    className={`px-4 py-2 font-mono text-[10px] uppercase font-black tracking-widest border-b-2 transition-all ${
                        activeTab === 'profile' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Profile
                </button>
                <button
                    onClick={() => setActiveTab('activity')}
                    className={`px-4 py-2 font-mono text-[10px] uppercase font-black tracking-widest border-b-2 transition-all ${
                        activeTab === 'activity' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Activity
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4">
                {activeTab === 'profile' ? (
                    <>
                        <div className="lg:col-span-2 space-y-6">
                            {isEditing ? (
                                <div className="space-y-6 p-6 bg-white/[0.02] border border-white/5 rounded-sm">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Display name</label>
                                            <input
                                                type="text"
                                                value={editForm.display_name}
                                                onChange={e => setEditForm(prev => ({ ...prev, display_name: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none"
                                                placeholder="Shown on your public profile"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Username</label>
                                            <input
                                                type="text"
                                                value={editForm.username}
                                                onChange={e => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none"
                                                placeholder="letters, numbers, underscore"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Bio</label>
                                        <textarea
                                            value={editForm.bio}
                                            onChange={e => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                                            className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono h-24 focus:border-primary outline-none resize-none"
                                            placeholder="A short public bio"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Location</label>
                                            <input
                                                type="text"
                                                value={editForm.location}
                                                onChange={e => setEditForm(prev => ({ ...prev, location: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none"
                                                placeholder="Optional. Shown publicly. Leave blank to hide."
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Website</label>
                                            <input
                                                type="text"
                                                value={editForm.website}
                                                onChange={e => setEditForm(prev => ({ ...prev, website: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none"
                                                placeholder="https://"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Title</label>
                                            <input
                                                type="text"
                                                value={editForm.professional_title}
                                                onChange={e => setEditForm(prev => ({ ...prev, professional_title: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none"
                                                placeholder="Optional public title"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black font-mono uppercase text-primary/60 tracking-widest">Avatar URL</label>
                                            <input
                                                type="text"
                                                value={editForm.avatar_url.startsWith('data:') ? '' : editForm.avatar_url}
                                                onChange={e => setEditForm(prev => ({ ...prev, avatar_url: e.target.value }))}
                                                className="w-full bg-black/40 border border-white/10 p-2.5 rounded-sm text-[11px] font-mono focus:border-primary outline-none"
                                                placeholder={editForm.avatar_url.startsWith('data:') ? 'Using uploaded photo' : 'https://… or use Photo'}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-8">
                                    <div className="p-8 bg-white/[0.02] border border-white/5 rounded-sm relative overflow-hidden group">
                                        <h3 className="text-[9px] font-black font-mono text-primary uppercase tracking-[0.4em] mb-4 opacity-60 italic underline underline-offset-4 decoration-primary/30">Bio</h3>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium text-foreground/90">
                                            {profile.bio || 'No bio yet.'}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-white/[0.01] border border-white/5 p-4 rounded-sm flex items-center gap-4">
                                            <div className="p-2.5 rounded-sm bg-primary/10 border border-primary/20 text-primary">
                                                <MapPin size={16} />
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Location</p>
                                                <p className="text-[11px] font-bold font-mono uppercase tracking-tight">{profile.location || 'Not listed'}</p>
                                            </div>
                                        </div>
                                        <div className="bg-white/[0.01] border border-white/5 p-4 rounded-sm flex items-center gap-4">
                                            <div className="p-2.5 rounded-sm bg-secondary/10 border border-secondary/20 text-secondary">
                                                <Calendar size={16} />
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Joined</p>
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
                                <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] mb-4 opacity-40">Reputation</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-2">
                                            <Star size={12} className="text-amber-400" fill="currentColor" />
                                            <span className="text-muted-foreground/60 uppercase">Rating</span>
                                        </div>
                                        <span className="font-bold">
                                            {profile.reviews_count > 0 ? Number(profile.avg_rating ?? 0).toFixed(1) : '—'}{' '}
                                            <span className="text-[9px] opacity-40">({profile.reviews_count} reviews)</span>
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-2">
                                            <Activity size={12} className="text-primary" />
                                            <span className="text-muted-foreground/60 uppercase">Bandwidth sold</span>
                                        </div>
                                        <span className="font-bold uppercase">{Number(profile.total_bandwidth_sold ?? 0).toFixed(2)} GB</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] font-mono">
                                        <div className="flex items-center gap-2">
                                            <Users size={12} className="text-secondary" />
                                            <span className="text-muted-foreground/60 uppercase">Followers</span>
                                        </div>
                                        <span className="font-bold uppercase">{profile.followers_count} follower(s)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="lg:col-span-3 space-y-4">
                        {activityLoading ? (
                            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Loading activity...</p>
                        ) : activity.length === 0 ? (
                            <div className="bg-white/[0.02] border border-white/5 rounded-sm p-12 text-center text-muted-foreground font-mono space-y-4">
                                <p className="text-[10px] uppercase tracking-[0.2em] font-black">No activity yet</p>
                                <p className="text-[8px] opacity-40 max-w-sm mx-auto uppercase">Follows and public actions will show here.</p>
                            </div>
                        ) : (
                            activity.map((event) => (
                                <div key={event.id} className="p-4 bg-white/[0.01] border border-white/5 rounded-sm flex items-center gap-4">
                                    <div className="p-3 rounded-full bg-primary/10 text-primary">
                                        <History size={16} />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold font-mono uppercase tracking-tight">
                                            {event.event_type.replace(/_/g, ' ')} {event.content ? `— ${event.content}` : ''}
                                        </p>
                                        <p className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">
                                            {event.created_at ? new Date(event.created_at).toLocaleString() : ''}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
