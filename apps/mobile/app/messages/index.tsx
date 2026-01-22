import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { getConversations, Conversation } from '../../src/api/social-api';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

export default function MessagesListScreen() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const router = useRouter();

    const fetchConversations = async () => {
        try {
            const data = await getConversations();
            setConversations(data.conversations || []);
        } catch (error) {
            console.error("Messages Error:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchConversations();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchConversations();
    }, []);

    const renderItem = ({ item }: { item: Conversation }) => (
        <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/messages/${item.id}?name=${item.other_participant?.display_name || 'User'}`)}
        >
            <View style={styles.avatarContainer}>
                {item.other_participant?.avatar_url ? (
                    <Image source={{ uri: item.other_participant.avatar_url }} style={styles.avatar} />
                ) : (
                    <Text style={styles.avatarText}>
                        {(item.other_participant?.display_name?.[0] || "?").toUpperCase()}
                    </Text>
                )}
            </View>
            <View style={styles.content}>
                <View style={styles.topRow}>
                    <Text style={styles.name}>{item.other_participant?.display_name || "Unknown User"}</Text>
                    <Text style={styles.time}>
                        {item.last_message_at ? formatDistanceToNow(new Date(item.last_message_at), { addSuffix: false }) : ''}
                    </Text>
                </View>
                <View style={styles.messageRow}>
                    <Text style={[styles.lastMessage, item.unread_count && item.unread_count > 0 ? styles.unreadMessage : null]} numberOfLines={1}>
                        {item.last_message?.content || "No messages yet"}
                    </Text>
                    {item.unread_count ? (
                        <View style={styles.unreadBadge}>
                            <Text style={styles.unreadText}>{item.unread_count}</Text>
                        </View>
                    ) : null}
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
                <Text style={styles.title}>Messages</Text>
                <TouchableOpacity style={styles.composeButton}>
                    <Ionicons name="create-outline" size={24} color="#2563EB" />
                </TouchableOpacity>
            </View>

            <FlatList
                data={conversations}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="chatbubbles-outline" size={48} color="#D1D5DB" />
                        <Text style={styles.emptyText}>No messages yet</Text>
                        <TouchableOpacity style={styles.startChatButton}>
                            <Text style={styles.startChatText}>Start a conversation</Text>
                        </TouchableOpacity>
                    </View>
                }
            />
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
        paddingTop: 60, // Safe area
        paddingBottom: 20,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    backButton: {
        padding: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    composeButton: {
        padding: 4,
    },
    list: {
        padding: 0,
    },
    card: {
        flexDirection: 'row',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        alignItems: 'center',
    },
    avatarContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#F3F4F6',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    avatar: {
        width: '100%',
        height: '100%',
        borderRadius: 25,
    },
    avatarText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#6B7280',
    },
    content: {
        flex: 1,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
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
    messageRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    lastMessage: {
        fontSize: 14,
        color: '#6B7280',
        flex: 1,
        marginRight: 10,
    },
    unreadMessage: {
        fontWeight: 'bold',
        color: '#111827',
    },
    unreadBadge: {
        backgroundColor: '#2563EB',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    unreadText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: 'bold',
    },
    emptyContainer: {
        padding: 60,
        alignItems: 'center',
    },
    emptyText: {
        marginVertical: 16,
        color: '#9CA3AF',
        fontSize: 16,
    },
    startChatButton: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        backgroundColor: '#F3F4F6',
        borderRadius: 20,
    },
    startChatText: {
        color: '#2563EB',
        fontWeight: 'bold',
    },
});
