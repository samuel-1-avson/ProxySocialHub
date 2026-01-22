import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import client from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';

export default function Agents() {
    const [agents, setAgents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchAgents = async () => {
        try {
            const response = await client.get('/agents');
            setAgents(response.data || []);
        } catch (error) {
            console.log('Error fetching agents', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        fetchAgents();
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
                <Text style={styles.headerTitle}>Agent Marketplace</Text>
                <Text style={styles.headerSubtitle}>Deploy autonomous AI agents</Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                {agents.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="hardware-chip-outline" size={48} color="#D1D5DB" />
                        <Text style={styles.emptyText}>No agents available yet</Text>
                    </View>
                ) : (
                    agents.map((agent) => (
                        <View key={agent.id} style={styles.agentCard}>
                            <View style={styles.agentHeader}>
                                <View style={styles.iconContainer}>
                                    <Ionicons name="hardware-chip-outline" size={24} color="#2563EB" />
                                </View>
                                <View style={styles.versionBadge}>
                                    <Text style={styles.versionText}>v{agent.version}</Text>
                                </View>
                            </View>

                            <Text style={styles.agentName}>{agent.name}</Text>
                            <Text style={styles.agentDescription} numberOfLines={2}>
                                {agent.description || 'No description provided.'}
                            </Text>

                            <View style={styles.cardFooter}>
                                <View>
                                    <Text style={styles.costLabel}>Cost per run</Text>
                                    <Text style={styles.costValue}>{agent.price_per_run} TAO</Text>
                                </View>
                                <TouchableOpacity style={styles.deployButton}>
                                    <Text style={styles.deployButtonText}>Deploy</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>
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
        backgroundColor: '#FFFFFF',
    },
    header: {
        paddingTop: 64,
        paddingBottom: 24,
        paddingHorizontal: 24,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 4,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 40,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 80,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderStyle: 'dashed',
    },
    emptyText: {
        color: '#9CA3AF',
        marginTop: 16,
        fontWeight: '500',
    },
    agentCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#F3F4F6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    agentHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    iconContainer: {
        backgroundColor: '#EFF6FF',
        padding: 8,
        borderRadius: 12,
    },
    versionBadge: {
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    versionText: {
        fontSize: 10,
        color: '#6B7280',
        fontWeight: 'bold',
    },
    agentName: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    agentDescription: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 16,
        lineHeight: 20,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#F9FAFB',
        paddingTop: 16,
    },
    costLabel: {
        fontSize: 10,
        color: '#9CA3AF',
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    costValue: {
        color: '#2563EB',
        fontWeight: 'bold',
        fontSize: 14,
    },
    deployButton: {
        backgroundColor: '#2563EB',
        paddingHorizontal: 20,
        paddingVertical: 8,
        borderRadius: 12,
    },
    deployButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: 14,
    },
});
