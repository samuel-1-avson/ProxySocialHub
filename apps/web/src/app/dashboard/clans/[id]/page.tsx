"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getCircle, getCircleMembers, getCircleFeed, postToCircleFeed, Circle, CircleMember, CirclePost } from '@/lib/social-api';
import { ArrowLeft, Users, Zap, Shield, LayoutGrid, Target, Share2, Plus, Globe, Loader2, User, MessageSquare, Send } from 'lucide-react';

export default function CircleDetailsPage() {
    const params = useParams();
    const { isAuthenticated } = useAuth();
    const circleId = params?.id as string;
    const [circle, setCircle] = useState<Circle | null>(null);
    const [members, setMembers] = useState<CircleMember[]>([]);
    const [posts, setPosts] = useState<CirclePost[]>([]);
    const [newPost, setNewPost] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'hierarchy' | 'feed'>('hierarchy');
    const [error, setError] = useState('');

    useEffect(() => {
        if (circleId) {
            loadCircle();
        }
    }, [circleId]);

    const loadCircle = async () => {
        try {
            const data = await getCircle(circleId);
            setCircle(data);
            const membersData = await getCircleMembers(circleId);
            setMembers(membersData.members);
            const feedData = await getCircleFeed(circleId);
            setPosts(feedData.posts || []);
        } catch {
            setError('Circle network integrity compromised');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Tracing Neural Path...</p>
            </div>
        );
    }

    if (error || !circle) {
        return (
            <div className="max-w-2xl mx-auto py-20 px-6">
                <div className="card-retro p-8 bg-destructive/10 border-destructive/50 text-center space-y-6">
                    <div className="w-16 h-16 rounded-sm bg-destructive/20 flex items-center justify-center mx-auto text-destructive border border-destructive/50">
                        <Target size={32} />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-xl font-bold font-mono uppercase text-destructive">Protocol Breach</h2>
                        <p className="font-mono text-xs text-destructive/70">{error || 'IDENTIFICATION OF REQUESTED SUB-NETWORK FAILED.'}</p>
                    </div>
                    <Link
                        href="/dashboard/clans"
                        className="btn-retro btn-retro-outline bg-background inline-flex items-center gap-2"
                    >
                        <ArrowLeft size={16} />
                        RETURN TO GRID CORE
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <Link
                href="/dashboard/clans"
                className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase text-muted-foreground hover:text-primary transition-colors"
            >
                <ArrowLeft size={14} />
                Network Sub-Grid Index
            </Link>

            {/* Header Card */}
            <div className="card-retro p-8 bg-card group relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 text-[8rem] font-black text-muted-foreground opacity-[0.03] leading-none select-none pointer-events-none">
                    <Zap />
                </div>

                <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start gap-8">
                    <div className="space-y-6 flex-1">
                        <div className="flex items-start gap-4">
                            <div className="p-4 rounded-sm bg-primary/10 text-primary border border-primary/20">
                                <Zap size={32} />
                            </div>
                            <div className="space-y-2">
                                <h1 className="text-4xl font-bold font-mono uppercase tracking-tight">{circle.name}</h1>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-sm border border-border bg-secondary text-[10px] font-mono font-bold uppercase text-muted-foreground flex items-center gap-1">
                                        <Shield size={10} />
                                        {(circle.revenue_share_percent * 100).toFixed(0)}% TAX PROTOCOL
                                    </span>
                                    <span className="px-2 py-0.5 rounded-sm border border-border bg-secondary text-[10px] font-mono font-bold uppercase text-muted-foreground flex items-center gap-1">
                                        <Globe size={10} />
                                        {circle.visibility} DISCOVERY
                                    </span>
                                </div>
                            </div>
                        </div>

                        <p className="text-sm font-mono text-muted-foreground max-w-3xl leading-relaxed border-l-2 border-border pl-4">
                            {circle.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-8 pt-6 border-t border-dashed border-border">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Authorized Nodes</span>
                                <span className="text-2xl font-bold font-mono">{circle.member_count}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Active Extractions</span>
                                <span className="text-2xl font-bold font-mono text-muted-foreground/50">0</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Integrity Score</span>
                                <span className="text-2xl font-bold font-mono text-green-500">99.8</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 w-full lg:w-48">
                        <button className="btn-retro btn-retro-primary w-full py-3 text-xs flex justify-center">
                            AUTHORIZE ENTRY
                        </button>
                        <div className="flex gap-2">
                            <button className="flex-1 btn-retro btn-retro-outline bg-background flex justify-center p-2">
                                <Share2 size={16} />
                            </button>
                            <button className="flex-1 btn-retro btn-retro-outline bg-background flex justify-center p-2">
                                <SettingsIcon size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                {/* Proofs & Extractions */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                        <div className="flex items-center gap-2 font-mono text-sm font-bold uppercase">
                            <LayoutGrid size={16} className="text-primary" />
                            Network Proofs
                        </div>
                        <button className="flex items-center gap-1 text-[10px] font-bold font-mono uppercase text-primary hover:underline">
                            <Plus size={12} /> Link New Node
                        </button>
                    </div>

                    <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-sm bg-secondary/10">
                        <div className="p-4 bg-secondary rounded-full mb-4 opacity-50">
                            <Target className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="font-bold font-mono uppercase text-muted-foreground text-sm">Zero Indicators</h3>
                        <p className="font-mono text-xs text-muted-foreground/50 mt-1 max-w-xs text-center px-4">
                            SUB-NETWORK HAS NOT YET LINKED ANY VERIFIED EXTRACTION PROOFS.
                        </p>
                    </div>
                </div>

                {/* Sub-Network Hierarchy / Feed Sidebar */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 border-b border-border">
                        <button
                            onClick={() => setActiveTab('hierarchy')}
                            className={`pb-2 text-sm font-mono font-bold uppercase transition-colors ${activeTab === 'hierarchy' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Hierarchy
                        </button>
                        <button
                            onClick={() => setActiveTab('feed')}
                            className={`pb-2 text-sm font-mono font-bold uppercase transition-colors ${activeTab === 'feed' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Circle Feed
                        </button>
                    </div>

                    {activeTab === 'hierarchy' ? (
                        <div className="space-y-3">
                            <div className="flex justify-end mb-2">
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(`${window.location.origin}/join/${circleId}`);
                                        alert('Invite link copied to clipboard!');
                                    }}
                                    className="flex items-center gap-1 text-[10px] font-bold font-mono uppercase text-primary hover:underline">
                                    <Plus size={12} /> Invite Link
                                </button>
                            </div>
                            {/* Leader/Owner */}
                            <div className="card-retro p-4 bg-card flex items-center gap-4 hover:border-primary transition-colors cursor-pointer">
                                <div className="w-10 h-10 rounded-sm bg-primary/20 text-primary flex items-center justify-center border border-primary/20 font-bold font-mono">
                                    LE
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs font-bold font-mono uppercase">Network Architect</p>
                                    <p className="text-[10px] font-mono font-bold text-muted-foreground uppercase">Circle Leader [Admin]</p>
                                </div>
                                <Zap size={12} className="text-primary" />
                            </div>

                            {/* Members List */}
                            {members.length > 0 ? members.map((member) => (
                                <div key={member.user_id} className="flex items-center gap-4 p-3 border border-transparent hover:bg-secondary/20 hover:border-border transition-colors rounded-sm cursor-pointer opacity-80 hover:opacity-100">
                                    <div className="w-8 h-8 rounded-sm bg-secondary border border-border flex items-center justify-center text-[10px] font-mono font-bold text-muted-foreground uppercase">
                                        {(member.user?.email || 'Unknown').substring(0, 2)}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs font-bold font-mono uppercase truncate w-24">{member.user?.email.split('@')[0] || 'Unknown'}</p>
                                        <p className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{member.status}</p>
                                    </div>
                                    <div className={`w-1.5 h-1.5 rounded-full ${member.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                                </div>
                            )) : (
                                <div className="p-4 text-center text-xs font-mono text-muted-foreground">
                                    No additional nodes linked.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Post Input */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    className="flex-1 bg-secondary border border-border rounded-sm py-2 px-3 text-xs font-mono focus:border-primary focus:outline-none placeholder:text-muted-foreground/50"
                                    placeholder="Broadcast message..."
                                    value={newPost}
                                    onChange={(e) => setNewPost(e.target.value)}
                                    onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && newPost.trim()) {
                                            try {
                                                const res = await postToCircleFeed(circleId, newPost);
                                                setPosts([res.post, ...posts]);
                                                setNewPost('');
                                            } catch (err) {
                                                alert('Transmission failed');
                                            }
                                        }
                                    }}
                                />
                                <button
                                    onClick={async () => {
                                        if (newPost.trim()) {
                                            try {
                                                const res = await postToCircleFeed(circleId, newPost);
                                                setPosts([res.post, ...posts]);
                                                setNewPost('');
                                            } catch (err) {
                                                alert('Transmission failed');
                                            }
                                        }
                                    }}
                                    className="btn-retro btn-retro-primary p-2">
                                    <Send size={14} />
                                </button>
                            </div>

                            {/* Posts List */}
                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                                {posts.length > 0 ? posts.map((post) => (
                                    <div key={post.id} className="p-3 bg-card border border-border rounded-sm space-y-2">
                                        <div className="flex justify-between items-start">
                                            <span className="text-[10px] font-bold font-mono text-primary uppercase">
                                                {post.author?.email.split('@')[0] || 'Unknown'}
                                            </span>
                                            <span className="text-[9px] font-mono text-muted-foreground">
                                                {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <p className="text-xs font-mono text-foreground break-words">
                                            {post.content}
                                        </p>
                                    </div>
                                )) : (
                                    <div className="text-center py-8 text-[10px] font-mono text-muted-foreground italic">
                                        No transmissions detected.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function SettingsIcon({ size }: { size: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}
