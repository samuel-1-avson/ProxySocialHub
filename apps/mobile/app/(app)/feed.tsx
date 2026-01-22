import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Image, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { getFeed, FeedEvent } from '../../src/api/social-api';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

export default function FeedScreen() {
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const router = useRouter();

    const fetchFeed = async () => {
        try {
            const data = await getFeed(1);
            setEvents(data.events || []);
        } catch (error) {
            console.error("Feed Error:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchFeed();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchFeed();
    }, []);

    const getIconForEvent = (type: string) => {
        switch (type) {
            case 'listing_created': return <Ionicons name="cart" size={16} color="#2563EB" />;
            case 'order_created': return <Ionicons name="flash" size={16} color="#F59E0B" />;
            case 'review_posted': return <Ionicons name="star" size={16} color="#10B981" />;
            default: return <Ionicons name="notifications" size={16} color="#6B7280" />;
        }
    };

    const renderItem = ({ item }: { item: FeedEvent }) => (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={styles.avatarContainer}>
                    {item.actor?.avatar_url ? (
                        <Image source={{ uri: item.actor.avatar_url }} style={styles.avatar} />
                    ) : (
                        <Text style={styles.avatarText}>
                            {(item.actor?.display_name?.[0] || "?").toUpperCase()}
                        </Text>
                    )}
                </View>
                <View style={styles.headerText}>
                    <View style={styles.topRow}>
                        <Text style={styles.name}>{item.actor?.display_name || "User"}</Text>
                        <Text style={styles.time}>
                            {item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true }) : ''}
                        </Text>
                    </View>
                    <View style={styles.eventType}>
                        {getIconForEvent(item.event_type)}
                        <Text style={styles.eventTypeText}>
                            {item.event_type.replace('_', ' ').toUpperCase()}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.content}>
                <Text style={styles.contentText}>{item.content}</Text>
            </View>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.actionButton}>
                    <Ionicons name="heart-outline" size={18} color="#6B7280" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton}>
                    <Ionicons name="chatbubble-outline" size={18} color="#6B7280" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton}>
                    <Ionicons name="share-social-outline" size={18} color="#6B7280" />
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
            <View style={styles.screenHeader}>
                <Text style={styles.title}>Community Feed</Text>
                <TouchableOpacity onPress={() => router.push('/messages')}>
                    <Ionicons name="chatbubbles-outline" size={24} color="#111827" />
                </TouchableOpacity>
            </View>
            <FlatList
                data={events}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="people-outline" size={48} color="#D1D5DB" />
                        <Text style={styles.emptyText}>No activity yet</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    screenHeader: {
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 20,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: '900',
        color: '#111827',
        letterSpacing: -0.5,
    },
    list: {
        padding: 16,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    header: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    avatarContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
        overflow: 'hidden',
    },
    avatar: {
        width: '100%',
        height: '100%',
    },
    avatarText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#4B5563',
    },
    headerText: {
        flex: 1,
        justifyContent: 'center',
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    name: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
    },
    time: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    eventType: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    eventTypeText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#6B7280',
        letterSpacing: 0.5,
    },
    content: {
        marginBottom: 16,
    },
    contentText: {
        fontSize: 14,
        color: '#374151',
        lineHeight: 20,
    },
    footer: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingTop: 12,
        gap: 20,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 4,
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
