'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { getCircle, getCircleStats, joinCircle, leaveCircle, deleteCircle, getCircleMembers, getFriends, inviteToCircle, Circle, CircleStats, CircleMember, Friendship } from '@/lib/api';

export default function CircleDetailsPage({ params }: { params: { id: string } }) {
    const { user } = useAuth();
    const router = useRouter();
    const [circle, setCircle] = useState<Circle | null>(null);
    const [stats, setStats] = useState<CircleStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState('');
    const [joinError, setJoinError] = useState('');

    // Members & Invites
    const [members, setMembers] = useState<CircleMember[]>([]);
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [inviteLoading, setInviteLoading] = useState(false);
    const [inviteMsg, setInviteMsg] = useState('');

    useEffect(() => {
        loadData();
    }, [params.id]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [circleData, statsData, membersData] = await Promise.all([
                getCircle(params.id),
                getCircleStats(params.id).catch(() => null), // Stats might fail if empty
                getCircleMembers(params.id).catch(() => ({ members: [], count: 0 })),
            ]);
            setCircle(circleData);
            setStats(statsData);
            setMembers(membersData.members || []);
        } catch (err) {
            setError('Failed to load circle details');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = async () => {
        try {
            setJoining(true);
            setJoinError('');
            await joinCircle(params.id);
            // Ideally re-fetch or show success state
            alert('Successfully joined circle!');
            router.refresh();
            loadData(); // Reload to show updated membership
        } catch (err) {
            setJoinError('Failed to join circle. You might already be a member.');
            console.error(err);
        } finally {
            setJoining(false);
        }
    };

    const handleLeave = async () => {
        if (!confirm('Are you sure you want to leave this circle?')) return;
        try {
            setLoading(true);
            await leaveCircle(params.id);
            alert('Left circle successfully.');
            router.refresh();
            loadData();
        } catch (err) {
            alert('Failed to leave circle.');
            console.error(err);
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to DELETE this circle? This action cannot be undone.')) return;
        try {
            setLoading(true);
            await deleteCircle(params.id);
            alert('Circle deleted.');
            router.push('/circles');
        } catch (err) {
            alert('Failed to delete circle.');
            console.error(err);
            setLoading(false);
        }
    };

    const loadFriends = async () => {
        try {
            const data = await getFriends();
            setFriends(data);
            setShowInviteModal(true);
        } catch (err) {
            console.error(err);
            alert('Failed to load friends list');
        }
    };

    const handleInvite = async (friendId: string) => {
        try {
            setInviteLoading(true);
            await inviteToCircle(params.id, friendId);
            setInviteMsg('Invitation sent!');
            setTimeout(() => setInviteMsg(''), 3000);
        } catch (err) {
            setInviteMsg('Failed to invite.');
            console.error(err);
        } finally {
            setInviteLoading(false);
        }
    };

    const isMember = members.some(m => m.user_id === user?.id);
    const isOwner = user?.id === circle?.owner_id;

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="spinner w-8 h-8 border-4 border-primary border-t-transparent"></div>
            </div>
        );
    }

    if (error || !circle) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
                <h1 className="text-2xl font-bold mb-4">Error</h1>
                <p className="text-muted mb-6">{error || 'Circle not found'}</p>
                <Link href="/circles" className="btn btn-primary">Back to Circles</Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background pb-20 md:pb-0">
            {/* Header */}
            <header className="bg-card/50 border-b border-card-border sticky top-0 md:relative z-40 backdrop-blur-md">
                <div className="container mx-auto px-4 md:px-6 py-4 flex items-center gap-4">
                    <Link href="/circles" className="text-muted hover:text-foreground">
                        ← Back to Circles
                    </Link>
                </div>
            </header>

            <main className="container mx-auto px-4 md:px-6 py-8">

                {/* Hero Section */}
                <div className="card mb-8 text-center md:text-left md:flex md:items-start md:gap-8">
                    <div className={`w-24 h-24 mx-auto md:mx-0 rounded-full flex items-center justify-center text-3xl font-bold mb-4 md:mb-0 shrink-0
              ${circle.visibility === 'public' ? 'bg-primary/20 text-primary' : 'bg-purple-500/20 text-purple-500'}
            `}>
                        {circle.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                        <div className="flex flex-col md:flex-row md:items-center gap-2 mb-2 justify-center md:justify-start">
                            <h1 className="text-3xl font-bold">{circle.name}</h1>
                            <span className={`text-xs px-2 py-1 rounded-full border inline-block w-fit mx-auto md:mx-0
                        ${circle.visibility === 'public'
                                    ? 'border-primary/30 text-primary bg-primary/5'
                                    : 'border-purple-500/30 text-purple-500 bg-purple-500/5'}
                    `}>
                                {circle.visibility}
                            </span>
                        </div>
                        <p className="text-muted text-lg mb-6">{circle.description}</p>

                        <div className="flex flex-col md:flex-row gap-4 justify-center md:justify-start">
                            {!isMember && (
                                <button
                                    onClick={handleJoin}
                                    disabled={joining}
                                    className="btn btn-primary shadow-retro disabled:opacity-50 min-w-[150px]"
                                >
                                    {joining ? 'Joining...' : 'Join Circle'}
                                </button>
                            )}

                            {isMember && !isOwner && (
                                <button
                                    onClick={handleLeave}
                                    className="btn bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20"
                                >
                                    Leave Circle
                                </button>
                            )}

                            {isOwner && (
                                <button
                                    onClick={handleDelete}
                                    className="btn bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20"
                                >
                                    Delete Circle
                                </button>
                            )}


                            {(isMember || isOwner) && (
                                <button
                                    onClick={loadFriends}
                                    className="btn btn-secondary"
                                >
                                    + Invite Friends
                                </button>
                            )}
                        </div>
                        {joinError && <p className="text-red-400 text-sm mt-3">{joinError}</p>}
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <div className="card text-center p-6">
                        <div className="text-3xl mb-2">👥</div>
                        <div className="text-2xl font-bold">{circle.member_count}</div>
                        <div className="text-xs text-muted">Members</div>
                    </div>
                    <div className="card text-center p-6">
                        <div className="text-3xl mb-2">⚡</div>
                        <div className="text-2xl font-bold">{stats?.active_nodes || 0}</div>
                        <div className="text-xs text-muted">Active Nodes</div>
                    </div>
                    <div className="card text-center p-6">
                        <div className="text-3xl mb-2">📊</div>
                        <div className="text-2xl font-bold">{stats?.total_bytes_gb.toFixed(1) || 0} GB</div>
                        <div className="text-xs text-muted">Total Traffic</div>
                    </div>
                    <div className="card text-center p-6">
                        <div className="text-3xl mb-2">💰</div>
                        <div className="text-2xl font-bold">₵{stats?.total_revenue.toFixed(2) || '0.00'}</div>
                        <div className="text-xs text-muted">Revenue Generated</div>
                    </div>
                </div>

                {/* Members Section is below */}

                {/* Members Section */}
                <div className="card mt-8">
                    <h3 className="text-lg font-bold mb-4">Members ({members.length})</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {members.map(member => (
                            <div key={member.id} className="flex items-center gap-3 p-3 bg-background/50 rounded-lg border border-card-border">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                                    {member.user?.email.charAt(0).toUpperCase() || '?'}
                                </div>
                                <div>
                                    <div className="font-semibold text-sm">{member.user?.email.split('@')[0]}</div>
                                    <div className="text-xs text-muted capitalize">{member.role}</div>
                                </div>
                                {member.role === 'owner' && <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-1 rounded">👑 Owner</span>}
                            </div>
                        ))}
                        {members.length === 0 && <p className="text-muted italic">No members found.</p>}
                    </div>
                </div>

                {/* Invite Modal */}
                {
                    showInviteModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                            <div className="card w-full max-w-md max-h-[80vh] overflow-y-auto">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xl font-bold">Invite Friends</h3>
                                    <button onClick={() => setShowInviteModal(false)} className="text-muted hover:text-foreground">✕</button>
                                </div>

                                {inviteMsg && <div className={`mb-4 p-2 rounded text-sm ${inviteMsg.includes('Failed') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>{inviteMsg}</div>}

                                <div className="space-y-2">
                                    {friends.length > 0 ? (
                                        friends.map(friend => (
                                            <div key={friend.id} className="flex items-center justify-between p-3 bg-background/50 rounded border border-card-border">
                                                <span>{friend.friend.email}</span>
                                                <button
                                                    onClick={() => handleInvite(friend.friend.id)}
                                                    disabled={inviteLoading}
                                                    className="btn btn-sm btn-primary"
                                                >
                                                    Invite
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-muted">
                                            <p>No friends found.</p>
                                            <Link href="/profile" className="text-primary hover:underline text-sm">Add friends in Profile</Link>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }

            </main >
        </div >
    );
}
