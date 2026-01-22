import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { getThreads, Thread } from '../../src/api/forum';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

export default function ForumListScreen() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const router = useRouter();

    const fetchThreads = async () => {
        try {
            const data = await getThreads();
            setThreads(data);
        } catch (error) {
            console.error("Forum Error:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchThreads();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchThreads();
    }, []);

    const renderItem = ({ item }: { item: Thread }) => (
        <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/forum/${item.id}`)}
        >
            <View style={styles.cardHeader}>
                <View style={styles.authorContainer}>
                    <Image source={{ uri: item.author?.avatar_url }} style={styles.avatar} />
                    <View>
                        <Text style={styles.authorName}>{item.author?.username}</Text>
                        <Text style={styles.timestamp}>
                            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </Text>
                    </View>
                </View>
                <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{item.category}</Text>
                </View>
            </View>

            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.preview} numberOfLines={2}>{item.content}</Text>

            <View style={styles.statsRow}>
                <View style={styles.stat}>
                    <Ionicons name="chatbubble-outline" size={16} color="#6B7280" />
                    <Text style={styles.statText}>{item.reply_count}</Text>
                </View>
                <View style={styles.stat}>
                    <Ionicons name="eye-outline" size={16} color="#6B7280" />
                    <Text style={styles.statText}>{item.views}</Text>
                </View>
            </View>
        </TouchableOpacity>
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
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Discussions</Text>
                <TouchableOpacity onPress={() => router.push('/forum/create')} style={styles.createButton}>
                    <Ionicons name="add" size={24} color="#2563EB" />
                </TouchableOpacity>
            </View>

            <FlatList
                data={threads}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="chatbubbles-outline" size={48} color="#D1D5DB" />
                        <Text style={styles.emptyText}>No discussions yet</Text>
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
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    createButton: {
        padding: 4,
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
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    authorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        marginRight: 8,
        backgroundColor: '#E5E7EB',
    },
    authorName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    timestamp: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    categoryBadge: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    categoryText: {
        fontSize: 12,
        color: '#2563EB',
        fontWeight: '500',
    },
    title: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    preview: {
        fontSize: 14,
        color: '#4B5563',
        marginBottom: 12,
        lineHeight: 20,
    },
    statsRow: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        paddingTop: 12,
    },
    stat: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    statText: {
        fontSize: 12,
        color: '#6B7280',
        marginLeft: 4,
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
