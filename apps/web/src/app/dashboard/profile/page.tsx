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
        setSaving(true);
        try {
            const updated = await updateProfile(editForm);
            setProfile(updated);
            setIsEditing(false);
        } catch (err) {
            alert('Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center font-mono">LOADING PROFILE DATA...</div>;
    if (!profile) return null;

    return (
        <div className="max-w-4xl mx-auto pb-20 animate-in fade-in duration-500">
            {/* Cover Image */}
            <div className="h-48 md:h-64 rounded-t-lg bg-gradient-to-r from-primary/10 to-secondary/10 relative overflow-hidden border-b border-border">
                {profile.cover_image_url ? (
                    <img src={profile.cover_image_url} alt="Cover" className="w-full h-full object-cover opacity-50" />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/20">
                        <Activity size={64} />
                    </div>
                )}
                {isEditing && (
                    <button className="absolute top-4 right-4 bg-background/80 p-2 rounded-sm text-xs font-mono backdrop-blur-sm border border-border hover:text-primary">
                        CHANGE COVER
                    </button>
                )}
            </div>

            {/* Profile Header */}
            <div className="relative px-6 pb-6 bg-card border-x border-b border-border rounded-b-lg mb-6">
                <div className="flex flex-col md:flex-row items-start md:items-end gap-6 -mt-12 mb-6">
                    {/* Avatar */}
                    <div className="relative group">
                        <div className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-card bg-secondary flex items-center justify-center overflow-hidden">
                            {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
                            ) : (
                                <User size={48} className="text-muted-foreground" />
                            )}
                        </div>
                        {isEditing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white text-xs font-mono">
                                CHANGE
                            </div>
                        )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 space-y-2">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <h1 className="text-2xl font-bold font-mono uppercase">
                                    {profile.display_name || 'Anonymous User'}
                                    {profile.verified && <Shield className="inline ml-2 text-primary w-5 h-5" fill="currentColor" />}
                                </h1>
                                <p className="text-muted-foreground font-mono">@{profile.username || 'user'}</p>
                            </div>

                            {!isEditing ? (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="btn-retro btn-retro-outline flex items-center gap-2 text-xs"
                                >
                                    <Edit2 size={14} /> EDIT PROFILE
                                </button>
                            ) : (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="btn-retro btn-retro-ghost text-xs"
                                    >
                                        CANCEL
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="btn-retro btn-retro-primary flex items-center gap-2 text-xs"
                                    >
                                        <Save size={14} /> {saving ? 'SAVING...' : 'SAVE CHANGES'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Stats */}
                        <div className="flex gap-6 text-sm font-mono border-y border-dashed border-border py-4 my-4">
                            <div className="flex items-center gap-2">
                                <Users size={14} className="text-primary" />
                                <span className="font-bold">{profile.followers_count}</span>
                                <span className="text-muted-foreground">Followers</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Users size={14} className="text-primary" />
                                <span className="font-bold">{profile.following_count}</span>
                                <span className="text-muted-foreground">Following</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Star size={14} className="text-primary" />
                                <span className="font-bold">{profile.avg_rating.toFixed(1)}</span>
                                <span className="text-muted-foreground">Rating ({profile.reviews_count})</span>
                            </div>
                        </div>

                        {/* Bio & Details */}
                        {isEditing ? (
                            <div className="space-y-4 max-w-xl">
                                <div>
                                    <label className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Display Name</label>
                                    <input
                                        type="text"
                                        value={editForm.display_name || ''}
                                        onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                                        className="w-full bg-secondary border border-border p-2 rounded-sm text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Bio</label>
                                    <textarea
                                        value={editForm.bio || ''}
                                        onChange={e => setEditForm({ ...editForm, bio: e.target.value })}
                                        className="w-full bg-secondary border border-border p-2 rounded-sm text-sm font-mono h-24"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Location</label>
                                        <input
                                            type="text"
                                            value={editForm.location || ''}
                                            onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                                            className="w-full bg-secondary border border-border p-2 rounded-sm text-sm font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold font-mono uppercase text-muted-foreground">Website</label>
                                        <input
                                            type="text"
                                            value={editForm.website || ''}
                                            onChange={e => setEditForm({ ...editForm, website: e.target.value })}
                                            className="w-full bg-secondary border border-border p-2 rounded-sm text-sm font-mono"
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4 max-w-xl">
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{profile.bio || 'No bio provided.'}</p>
                                <div className="flex flex-wrap gap-4 text-xs font-mono text-muted-foreground">
                                    {profile.location && (
                                        <div className="flex items-center gap-1">
                                            <MapPin size={12} /> {profile.location}
                                        </div>
                                    )}
                                    {profile.website && (
                                        <div className="flex items-center gap-1">
                                            <LinkIcon size={12} />
                                            <a href={profile.website} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline">
                                                {new URL(profile.website).hostname}
                                            </a>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1">
                                        <Calendar size={12} /> Joined {new Date(profile.created_at).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
