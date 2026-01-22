import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { getProposals, Proposal } from '../../src/api/governance';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

export default function GovernanceListScreen() {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const router = useRouter();

    const fetchProposals = async () => {
        try {
            const data = await getProposals();
            setProposals(data.proposals || []);
        } catch (error) {
            console.error("Governance Error:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchProposals();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchProposals();
    }, []);

    const renderItem = ({ item }: { item: Proposal }) => {
        const isActive = item.status === 'active';
        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => router.push(`/governance/${item.id}`)}
            >
                <View style={[styles.statusBadge, isActive ? styles.activeBadge : styles.closedBadge]}>
                    <Text style={[styles.statusText, isActive ? styles.activeText : styles.closedText]}>
                        {item.status.toUpperCase()}
                    </Text>
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>

                <View style={styles.metaRow}>
                    <Text style={styles.metaText}>
                        Ends {item.end_date ? formatDistanceToNow(new Date(item.end_date), { addSuffix: true }) : ''}
                    </Text>
                    <Text style={styles.metaText}>
                        {item.total_votes} votes
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.title}>Governance</Text>
                <View style={{ width: 24 }} />
            </View>

            <FlatList
                data={proposals}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="file-tray-outline" size={48} color="#D1D5DB" />
                        <Text style={styles.emptyText}>No proposals yet</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
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
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    backButton: {
        padding: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    list: {
        padding: 16,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    statusBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginBottom: 8,
    },
    activeBadge: {
        backgroundColor: '#D1FAE5',
    },
    closedBadge: {
        backgroundColor: '#F3F4F6',
    },
    statusText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    activeText: {
        color: '#059669',
    },
    closedText: {
        color: '#6B7280',
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    cardDesc: {
        fontSize: 14,
        color: '#4B5563',
        marginBottom: 12,
        lineHeight: 20,
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingTop: 8,
    },
    metaText: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        marginTop: 10,
        color: '#9CA3AF',
        fontSize: 16,
    },
});
