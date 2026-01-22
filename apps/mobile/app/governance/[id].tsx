import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getProposals, voteProposal, Proposal } from '../../src/api/governance';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

export default function ProposalDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [loading, setLoading] = useState(true);
    const [voting, setVoting] = useState(false);

    useEffect(() => {
        // In real app, we'd fetch single proposal by ID. 
        // For mock, we'll fetch all and find it.
        const fetchProposal = async () => {
            try {
                const data = await getProposals();
                const found = data.proposals.find(p => p.id === id);
                setProposal(found || null);
            } catch (error) {
                console.error("Fetch Error:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchProposal();
    }, [id]);

    const handleVote = async (voteType: 'for' | 'against') => {
        setVoting(true);
        try {
            await voteProposal(id as string, voteType);
            Alert.alert("Success", "Your vote has been recorded!");
            // Optimistically update UI
            if (proposal) {
                setProposal({
                    ...proposal,
                    votes_for: voteType === 'for' ? proposal.votes_for + 1 : proposal.votes_for,
                    votes_against: voteType === 'against' ? proposal.votes_against + 1 : proposal.votes_against,
                    total_votes: proposal.total_votes + 1,
                    user_vote: voteType
                });
            }
        } catch (error) {
            Alert.alert("Error", "Failed to cast vote");
        } finally {
            setVoting(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
            </View>
        );
    }

    if (!proposal) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Proposal not found</Text>
            </View>
        );
    }

    const isActive = proposal.status === 'active';
    const total = proposal.total_votes || 1; // avoid div by 0
    const forPercent = ((proposal.votes_for / total) * 100).toFixed(1);
    const againstPercent = ((proposal.votes_against / total) * 100).toFixed(1);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>Proposal #{proposal.id}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.titleSection}>
                    <View style={[styles.statusBadge, isActive ? styles.activeBadge : styles.closedBadge]}>
                        <Text style={[styles.statusText, isActive ? styles.activeText : styles.closedText]}>
                            {proposal.status.toUpperCase()}
                        </Text>
                    </View>
                    <Text style={styles.title}>{proposal.title}</Text>
                    <Text style={styles.metaText}>
                        Proposer: {proposal.proposer} • Ends {formatDistanceToNow(new Date(proposal.end_date), { addSuffix: true })}
                    </Text>
                </View>

                <View style={styles.descSection}>
                    <Text style={styles.sectionHeader}>Description</Text>
                    <Text style={styles.descText}>{proposal.description}</Text>
                </View>

                <View style={styles.votesSection}>
                    <Text style={styles.sectionHeader}>Current Results</Text>

                    <View style={styles.resultRow}>
                        <View style={styles.resultLabel}>
                            <Text style={styles.voteType}>For</Text>
                            <Text style={styles.voteCount}>{proposal.votes_for} ({forPercent}%)</Text>
                        </View>
                        <View style={styles.barBg}>
                            <View style={[styles.barFill, { width: `${forPercent}%` as any, backgroundColor: '#10B981' }]} />
                        </View>
                    </View>

                    <View style={styles.resultRow}>
                        <View style={styles.resultLabel}>
                            <Text style={styles.voteType}>Against</Text>
                            <Text style={styles.voteCount}>{proposal.votes_against} ({againstPercent}%)</Text>
                        </View>
                        <View style={styles.barBg}>
                            <View style={[styles.barFill, { width: `${againstPercent}%` as any, backgroundColor: '#EF4444' }]} />
                        </View>
                    </View>
                </View>
            </ScrollView>

            {isActive && (
                <View style={styles.footer}>
                    {proposal.user_vote ? (
                        <View style={styles.votedContainer}>
                            <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                            <Text style={styles.votedText}>You voted {proposal.user_vote.toUpperCase()}</Text>
                        </View>
                    ) : (
                        <View style={styles.buttonRow}>
                            <TouchableOpacity
                                style={[styles.voteButton, styles.voteFor]}
                                onPress={() => handleVote('for')}
                                disabled={voting}
                            >
                                <Text style={styles.voteButtonText}>Vote For</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.voteButton, styles.voteAgainst]}
                                onPress={() => handleVote('against')}
                                disabled={voting}
                            >
                                <Text style={styles.voteButtonText}>Vote Against</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        maxWidth: '70%',
    },
    content: {
        padding: 24,
    },
    titleSection: {
        marginBottom: 32,
    },
    statusBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        marginBottom: 16,
    },
    activeBadge: {
        backgroundColor: '#D1FAE5',
    },
    closedBadge: {
        backgroundColor: '#F3F4F6',
    },
    statusText: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    activeText: {
        color: '#059669',
    },
    closedText: {
        color: '#6B7280',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
    },
    metaText: {
        fontSize: 14,
        color: '#6B7280',
    },
    descSection: {
        marginBottom: 32,
    },
    sectionHeader: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
    },
    descText: {
        fontSize: 16,
        color: '#4B5563',
        lineHeight: 24,
    },
    votesSection: {
        marginBottom: 32,
    },
    resultRow: {
        marginBottom: 16,
    },
    resultLabel: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    voteType: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    voteCount: {
        fontSize: 14,
        color: '#6B7280',
    },
    barBg: {
        height: 8,
        backgroundColor: '#F3F4F6',
        borderRadius: 4,
        overflow: 'hidden',
    },
    barFill: {
        height: '100%',
        borderRadius: 4,
    },
    footer: {
        padding: 20,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        backgroundColor: '#FFF',
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 16,
    },
    voteButton: {
        flex: 1,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 24,
    },
    voteFor: {
        backgroundColor: '#10B981',
    },
    voteAgainst: {
        backgroundColor: '#EF4444',
    },
    voteButtonText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 16,
    },
    votedContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        backgroundColor: '#F0FDF4',
        borderRadius: 12,
    },
    votedText: {
        color: '#166534',
        fontWeight: 'bold',
        fontSize: 16,
    },
    errorText: {
        fontSize: 18,
        color: '#EF4444',
        textAlign: 'center',
        marginTop: 40,
    }
});
