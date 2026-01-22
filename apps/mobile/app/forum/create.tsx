import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { createThread } from '../../src/api/forum';
import { Ionicons } from '@expo/vector-icons';

export default function CreateThreadScreen() {
    const router = useRouter();
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [category, setCategory] = useState('General');
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!title.trim() || !content.trim()) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        setCreating(true);
        try {
            await createThread(title, content, category);
            router.back();
            // In a real app we might want to refresh the list or navigate to the new thread
        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to create thread');
        } finally {
            setCreating(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.container}
        >
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>New Discussion</Text>
                <TouchableOpacity onPress={handleCreate} disabled={creating} style={styles.postButton}>
                    {creating ? (
                        <ActivityIndicator size="small" color="#2563EB" />
                    ) : (
                        <Text style={styles.postButtonText}>Post</Text>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.form}>
                <Text style={styles.label}>Title</Text>
                <TextInput
                    style={styles.inputTitle}
                    placeholder="What's on your mind?"
                    value={title}
                    onChangeText={setTitle}
                    maxLength={100}
                />

                <Text style={styles.label}>Category</Text>
                <View style={styles.categoryRow}>
                    {['General', 'Automation', 'Guides', 'Support'].map(cat => (
                        <TouchableOpacity
                            key={cat}
                            style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                            onPress={() => setCategory(cat)}
                        >
                            <Text style={[styles.categoryText, category === cat && styles.categoryTextActive]}>
                                {cat}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <Text style={styles.label}>Content</Text>
                <TextInput
                    style={styles.inputContent}
                    placeholder="Share your thoughts..."
                    value={content}
                    onChangeText={setContent}
                    multiline
                    textAlignVertical="top"
                />
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 20, // Modal presentation usually handles status bar, but extra padding helps
        paddingBottom: 16,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    closeButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
    },
    postButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
    },
    postButtonText: {
        color: '#2563EB',
        fontWeight: '600',
        fontSize: 14,
    },
    form: {
        padding: 20,
        flex: 1,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        marginTop: 16,
    },
    inputTitle: {
        fontSize: 18,
        fontWeight: '600',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        paddingVertical: 8,
        marginBottom: 8,
    },
    categoryRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 8,
    },
    categoryChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#F3F4F6',
        marginRight: 8,
        marginBottom: 8,
    },
    categoryChipActive: {
        backgroundColor: '#2563EB',
    },
    categoryText: {
        fontSize: 13,
        color: '#4B5563',
    },
    categoryTextActive: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    inputContent: {
        flex: 1,
        fontSize: 16,
        lineHeight: 24,
        paddingVertical: 12,
    },
});
