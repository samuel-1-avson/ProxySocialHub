import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { getListings, Listing, createOrder } from '../../src/api/social-api';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';

export default function MarketplaceScreen() {
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [isPurchasing, setIsPurchasing] = useState(false);
    const router = useRouter();

    const fetchListings = async () => {
        try {
            const data = await getListings({ page: 1, sort_by: 'newest' });
            setListings(data.listings);
        } catch (error: any) {
            console.error(error);
            Alert.alert('Error', 'Failed to load listings');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchListings();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchListings();
    }, []);

    const handleBuy = async (listing: Listing) => {
        // Simple 1-step purchase for now (Pay-As-You-Go simulation)
        Alert.alert(
            "Purchase Bandwidth",
            `Connect to ${listing.title} at ₵${listing.price_per_gb}/GB?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Connect",
                    onPress: async () => {
                        setIsPurchasing(true);
                        try {
                            // Default to 1GB purchase or Pay-As-You-Go start
                            await createOrder(listing.id, 1);
                            Alert.alert("Success", "Connection established! You can now use this proxy.");
                            // Future: navigate to session details
                        } catch (error: any) {
                            Alert.alert("Failed", error.message || "Could not complete purchase");
                        } finally {
                            setIsPurchasing(false);
                        }
                    }
                }
            ]
        );
    };

    const renderItem = ({ item }: { item: Listing }) => (
        <View style={styles.card}>
            {/* Header */}
            <View style={styles.cardHeader}>
                <View style={styles.avatarContainer}>
                    {item.seller?.avatar_url ? (
                        <Image source={{ uri: item.seller.avatar_url }} style={styles.avatar} />
                    ) : (
                        <Text style={styles.avatarText}>{(item.seller?.display_name?.[0] || "?").toUpperCase()}</Text>
                    )}
                </View>
                <View style={styles.headerInfo}>
                    <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                    <View style={styles.badges}>
                        <View style={styles.badge}>
                            <FontAwesome5 name="star" size={10} color="#F59E0B" />
                            <Text style={styles.badgeText}>{item.seller?.avg_rating?.toFixed(1) || "5.0"}</Text>
                        </View>
                        <Text style={styles.separator}>|</Text>
                        <Text style={styles.typeText}>{item.proxy_type}</Text>
                    </View>
                </View>
            </View>

            {/* Stats */}
            <View style={styles.statsContainer}>
                <View style={styles.stat}>
                    <Text style={styles.statLabel}>SPEED</Text>
                    <View style={styles.statValueRow}>
                        <Ionicons name="cellular" size={12} color="#10B981" />
                        <Text style={styles.statValue}>{item.avg_latency_ms || '<50'}ms</Text>
                    </View>
                </View>
                <View style={styles.statBorder} />
                <View style={styles.stat}>
                    <Text style={styles.statLabel}>SCORE</Text>
                    <View style={styles.statValueRow}>
                        <Ionicons name="pulse" size={12} color="#3B82F6" />
                        <Text style={styles.statValue}>{(item.quality_score || 0).toFixed(0)}/100</Text>
                    </View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
                <View>
                    <Text style={styles.rateLabel}>RATE</Text>
                    <Text style={styles.price}>
                        ₵{item.price_per_gb}
                        <Text style={styles.unit}>/GB</Text>
                    </Text>
                </View>
                <TouchableOpacity
                    style={styles.connectButton}
                    onPress={() => handleBuy(item)}
                    disabled={isPurchasing}
                >
                    {isPurchasing ? (
                        <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                        <>
                            <Ionicons name="wifi" size={16} color="#FFF" style={{ marginRight: 6 }} />
                            <Text style={styles.connectButtonText}>CONNECT</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );

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
                <Text style={styles.headerTitle}>Node Market</Text>
                <Text style={styles.headerSubtitle}>ACQUIRE DECENTRALIZED BANDWIDTH</Text>
            </View>

            <FlatList
                data={listings}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="server-outline" size={48} color="#9CA3AF" />
                        <Text style={styles.emptyText}>No Nodes Found</Text>
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
        padding: 20,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    headerSubtitle: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#6B7280',
        letterSpacing: 1,
    },
    listContent: {
        padding: 16,
        gap: 16,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        overflow: 'hidden',
        marginBottom: 16,
    },
    cardHeader: {
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    avatarContainer: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: '#F3F4F6',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
        overflow: 'hidden',
    },
    avatar: {
        width: '100%',
        height: '100%',
    },
    avatarText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#374151',
    },
    headerInfo: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    badges: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4B5563',
    },
    separator: {
        marginHorizontal: 8,
        color: '#D1D5DB',
        fontSize: 10,
    },
    typeText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#2563EB',
        textTransform: 'uppercase',
    },
    statsContainer: {
        flexDirection: 'row',
        backgroundColor: '#F9FAFB',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    stat: {
        flex: 1,
        padding: 12,
        alignItems: 'center',
    },
    statBorder: {
        width: 1,
        backgroundColor: '#E5E7EB',
    },
    statLabel: {
        fontSize: 10,
        color: '#6B7280',
        fontWeight: 'bold',
        marginBottom: 4,
    },
    statValueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    statValue: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#111827',
    },
    footer: {
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rateLabel: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#6B7280',
        marginBottom: 2,
    },
    price: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    unit: {
        fontSize: 12,
        fontWeight: 'normal',
        color: '#6B7280',
    },
    connectButton: {
        backgroundColor: '#2563EB',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    connectButtonText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 0.5,
    },
    emptyContainer: {
        alignItems: 'center',
        paddingTop: 60,
    },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
        fontWeight: '600',
        color: '#9CA3AF',
        textTransform: 'uppercase',
    },
});
