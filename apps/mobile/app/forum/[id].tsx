import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, Platform, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getThreadDetails, getReplies, postReply, Thread, Reply } from '../../src/api/forum';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

export default function ThreadDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const [thread, setThread] = useState<Thread | null>(null);
    const [replies, setReplies] = useState<Reply[]>([]);
    const [loading, setLoading] = useState(true);
    const [replyText, setReplyText] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (id) {
            loadData(id as string);
        }
    }, [id]);

    const loadData = async (threadId: string) => {
        try {
            const [threadData, repliesData] = await Promise.all([
                getThreadDetails(threadId),
                getReplies(threadId)
            ]);
            setThread(threadData);
            setReplies(repliesData);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSendReply = async () => {
        if (!replyText.trim()) return;
        setSending(true);
        try {
            const newReply = await postReply(id as string, replyText);
            setReplies([...replies, newReply]);
            setReplyText('');
        } catch (error) {
            console.error(error);
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
            </View>
        );
    }

    if (!thread) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Thread not found</Text>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.container}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>{thread.title}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Main Post */}
                <View style={styles.mainPost}>
                    <View style={styles.authorRow}>
                        <Image source={{ uri: thread.author?.avatar_url }} style={styles.avatarLarge} />
                        <View>
                            <Text style={styles.authorNameLarge}>{thread.author?.username}</Text>
                            <Text style={styles.timestamp}>
                                {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                            </Text>
                        </View>
                    </View>
                    <Text style={styles.postTitle}>{thread.title}</Text>
                    <Text style={styles.postContent}>{thread.content}</Text>
                    <View style={styles.tagContainer}>
                        <Text style={styles.tagText}>{thread.category}</Text>
                    </View>
                </View>

                {/* Replies */}
                <Text style={styles.sectionHeader}>Replies ({replies.length})</Text>

                {replies.map(reply => (
                    <View key={reply.id} style={styles.replyCard}>
                        <View style={styles.authorRow}>
                            <Image source={{ uri: reply.author?.avatar_url }} style={styles.avatarSmall} />
                            <View>
                                <Text style={styles.authorNameSmall}>{reply.author?.username}</Text>
                                <Text style={styles.timestamp}>
                                    {formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.replyContent}>{reply.content}</Text>
                    </View>
                ))}
            </ScrollView>

            {/* Input Area */}
            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.input}
                    placeholder="Write a reply..."
                    value={replyText}
                    onChangeText={setReplyText}
                    multiline
                />
                <TouchableOpacity
                    style={[styles.sendButton, !replyText.trim() && styles.sendButtonDisabled]}
                    onPress={handleSendReply}
                    disabled={!replyText.trim() || sending}
                >
                    {sending ? (
                        <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                        <Ionicons name="send" size={20} color="#FFF" />
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
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
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        flex: 1,
        textAlign: 'center',
        marginHorizontal: 16,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 100,
    },
    mainPost: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatarLarge: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 10,
        backgroundColor: '#E5E7EB',
    },
    authorNameLarge: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
    },
    avatarSmall: {
        width: 32,
        height: 32,
        borderRadius: 16,
        marginRight: 8,
        backgroundColor: '#E5E7EB',
    },
    authorNameSmall: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    timestamp: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    postTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 8,
    },
    postContent: {
        fontSize: 16,
        color: '#374151',
        lineHeight: 24,
        marginBottom: 16,
    },
    tagContainer: {
        alignSelf: 'flex-start',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    tagText: {
        fontSize: 12,
        color: '#2563EB',
        fontWeight: '500',
    },
    sectionHeader: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 16,
    },
    replyCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    replyContent: {
        fontSize: 15,
        color: '#4B5563',
        lineHeight: 22,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        padding: 16,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
    },
    input: {
        flex: 1,
        backgroundColor: '#F3F4F6',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        maxHeight: 100,
        fontSize: 16,
        marginRight: 10,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonDisabled: {
        backgroundColor: '#9CA3AF',
    },
    errorText: {
        textAlign: 'center',
        marginTop: 40,
        color: '#EF4444',
    },
});
