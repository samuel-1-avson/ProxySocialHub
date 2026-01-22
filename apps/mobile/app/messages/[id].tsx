import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getMessages, sendMessage, Message } from '../../src/api/social-api';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';

export default function ChatScreen() {
    const { id, name } = useLocalSearchParams();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const flatListRef = useRef<FlatList>(null);
    const { user } = useAuth();
    const router = useRouter();

    const fetchMessages = async () => {
        try {
            const data = await getMessages(id as string);
            setMessages(data.messages || []);
        } catch (error) {
            console.error("Chat Error:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMessages();
        // Polling for demo purposes ( Realtime is better but requires more setup)
        const interval = setInterval(fetchMessages, 5000);
        return () => clearInterval(interval);
    }, [id]);

    const handleSend = async () => {
        if (!inputText.trim()) return;
        setSending(true);
        try {
            const tempId = Date.now().toString();
            const newMessage: Message = {
                id: tempId,
                conversation_id: id as string,
                sender_id: user?.id || '',
                content: inputText,
                created_at: new Date().toISOString(),
                sender: user ? {
                    id: user.id,
                    email: user.email || '',
                    role: 'user',
                    display_name: user.user_metadata?.display_name || 'Me',
                    avatar_url: user.user_metadata?.avatar_url,
                    verified: false,
                    followers_count: 0,
                    following_count: 0,
                    reviews_count: 0,
                    avg_rating: 0,
                    total_bandwidth_sold: 0,
                    trust_tier: 'bronze',
                    created_at: new Date().toISOString()
                } : undefined
            };

            // Optimistic update
            setMessages(prev => [...prev, newMessage]);
            setInputText('');

            await sendMessage(id as string, newMessage.content);
            // Re-fetch to confirm sync
            fetchMessages();
        } catch (error) {
            console.error("Send Error:", error);
            // Rollback could happen here
        } finally {
            setSending(false);
        }
    };

    const renderItem = ({ item }: { item: Message }) => {
        const isMe = item.sender_id === user?.id;
        return (
            <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
                <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.theirMessageText]}>
                    {item.content}
                </Text>
                <Text style={[styles.timeText, isMe ? styles.myTimeText : styles.theirTimeText]}>
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#111827" />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>{name || 'Chat'}</Text>
                    <View style={styles.onlineIndicator}>
                        <View style={styles.onlineDot} />
                        <Text style={styles.onlineText}>Online</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.headerAction}>
                    <Ionicons name="ellipsis-horizontal" size={24} color="#111827" />
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#2563EB" />
                </View>
            ) : (
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    renderItem={renderItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                />
            )}

            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
            >
                <View style={styles.inputContainer}>
                    <TouchableOpacity style={styles.attachButton}>
                        <Ionicons name="add" size={24} color="#6B7280" />
                    </TouchableOpacity>
                    <TextInput
                        style={styles.input}
                        placeholder="Type a message..."
                        value={inputText}
                        onChangeText={setInputText}
                        multiline
                    />
                    <TouchableOpacity
                        style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
                        onPress={handleSend}
                        disabled={!inputText.trim() || sending}
                    >
                        {sending ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <Ionicons name="send" size={20} color="#FFF" />
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
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
        paddingBottom: 16,
        paddingHorizontal: 16,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    backButton: {
        padding: 4,
    },
    headerCenter: {
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
    },
    onlineIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    onlineDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#10B981',
        marginRight: 4,
    },
    onlineText: {
        fontSize: 10,
        color: '#6B7280',
    },
    headerAction: {
        padding: 4,
    },
    listContent: {
        padding: 16,
    },
    messageBubble: {
        maxWidth: '80%',
        padding: 12,
        borderRadius: 16,
        marginBottom: 8,
    },
    myMessage: {
        alignSelf: 'flex-end',
        backgroundColor: '#2563EB',
        borderBottomRightRadius: 2,
    },
    theirMessage: {
        alignSelf: 'flex-start',
        backgroundColor: '#FFF',
        borderBottomLeftRadius: 2,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    messageText: {
        fontSize: 14,
        lineHeight: 20,
    },
    myMessageText: {
        color: '#FFF',
    },
    theirMessageText: {
        color: '#1F2937',
    },
    timeText: {
        fontSize: 10,
        marginTop: 4,
        alignSelf: 'flex-end',
    },
    myTimeText: {
        color: '#BFDBFE',
    },
    theirTimeText: {
        color: '#9CA3AF',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#FFF',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    attachButton: {
        padding: 8,
        marginRight: 8,
    },
    input: {
        flex: 1,
        backgroundColor: '#F3F4F6',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 14,
        maxHeight: 100,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 8,
    },
    sendButtonDisabled: {
        backgroundColor: '#D1D5DB',
    },
});
