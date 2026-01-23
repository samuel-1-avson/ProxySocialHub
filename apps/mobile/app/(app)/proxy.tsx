import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
    RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    createSession,
    getSessions,
    terminateSession,
    testProxyConnection,
    Session,
    ProxyCredentials,
} from '../../src/api/proxy';

// Proxy endpoint - UPDATE THIS for your setup
const PROXY_ENDPOINT = 'proxy.proxyhub.io:3128';

export default function ProxyScreen() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'online' | 'offline'>('idle');
    const [credentials, setCredentials] = useState<ProxyCredentials | null>(null);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        fetchSessions();
    }, []);

    async function fetchSessions() {
        try {
            const data = await getSessions();
            setSessions(data.filter(s => s.status === 'active'));
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    async function handleCreateSession(type: 'rotating' | 'sticky') {
        setCreating(true);
        try {
            const result = await createSession(type);
            setCredentials(result.proxy_credentials);
            await fetchSessions();
            Alert.alert('Session Created', 'Your proxy session is now active!');
        } catch (error) {
            Alert.alert('Error', 'Failed to create session. Please try again.');
        } finally {
            setCreating(false);
        }
    }

    async function handleTerminate(sessionId: string) {
        Alert.alert(
            'Terminate Session',
            'Are you sure you want to terminate this session?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Terminate',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await terminateSession(sessionId);
                            await fetchSessions();
                        } catch (error) {
                            Alert.alert('Error', 'Failed to terminate session.');
                        }
                    },
                },
            ]
        );
    }

    async function testConnection() {
        setConnectionStatus('testing');
        const result = await testProxyConnection();
        setConnectionStatus(result.status === 'online' ? 'online' : 'offline');
    }

    async function copyToClipboard(text: string, label: string) {
        await Clipboard.setStringAsync(text);
        Alert.alert('Copied', `${label} copied to clipboard`);
    }

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
                <Text style={styles.loadingText}>Loading Proxy...</Text>
            </View>
        );
    }

    const activeSession = sessions[0];

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => {
                    setRefreshing(true);
                    fetchSessions();
                }} />
            }
        >
            {/* Header */}
            <View style={styles.header}>
                <Ionicons name="globe" size={24} color="#2563EB" />
                <Text style={styles.headerTitle}>Proxy Gateway</Text>
            </View>
            <Text style={styles.headerSubtitle}>
                Connect to the decentralized proxy network
            </Text>

            {/* Connection Status */}
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <Ionicons name="server" size={20} color="#6B7280" />
                    <Text style={styles.cardTitle}>Gateway Status</Text>
                </View>

                <View style={styles.statusRow}>
                    <View style={styles.statusItem}>
                        <Text style={styles.statusLabel}>Endpoint</Text>
                        <TouchableOpacity onPress={() => copyToClipboard(PROXY_ENDPOINT, 'Endpoint')}>
                            <Text style={styles.statusValue}>{PROXY_ENDPOINT}</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.statusItem}>
                        <Text style={styles.statusLabel}>Status</Text>
                        <View style={styles.statusBadge}>
                            {connectionStatus === 'online' && (
                                <>
                                    <View style={[styles.statusDot, { backgroundColor: '#22C55E' }]} />
                                    <Text style={[styles.statusBadgeText, { color: '#22C55E' }]}>Online</Text>
                                </>
                            )}
                            {connectionStatus === 'offline' && (
                                <>
                                    <View style={[styles.statusDot, { backgroundColor: '#EF4444' }]} />
                                    <Text style={[styles.statusBadgeText, { color: '#EF4444' }]}>Offline</Text>
                                </>
                            )}
                            {connectionStatus === 'testing' && (
                                <ActivityIndicator size="small" color="#F59E0B" />
                            )}
                            {connectionStatus === 'idle' && (
                                <Text style={styles.statusBadgeText}>Not Tested</Text>
                            )}
                        </View>
                    </View>
                </View>

                <TouchableOpacity style={styles.testButton} onPress={testConnection}>
                    <Ionicons name="refresh" size={16} color="#FFF" />
                    <Text style={styles.testButtonText}>Test Connection</Text>
                </TouchableOpacity>
            </View>

            {/* Quick Setup */}
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <Ionicons name="flash" size={20} color="#6B7280" />
                    <Text style={styles.cardTitle}>Quick Setup</Text>
                </View>

                {activeSession ? (
                    <View>
                        <View style={styles.activeSessionBadge}>
                            <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                            <View style={{ marginLeft: 8 }}>
                                <Text style={styles.activeSessionText}>Session Active</Text>
                                <Text style={styles.activeSessionId}>
                                    {activeSession.type.toUpperCase()} • {activeSession.id.slice(0, 8)}...
                                </Text>
                            </View>
                        </View>

                        {credentials && (
                            <View style={styles.credentialsBox}>
                                <Text style={styles.credentialsTitle}>Credentials</Text>
                                <TouchableOpacity
                                    style={styles.credentialRow}
                                    onPress={() => copyToClipboard(credentials.username, 'Username')}
                                >
                                    <Text style={styles.credentialLabel}>Username:</Text>
                                    <Text style={styles.credentialValue}>{credentials.username}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.credentialRow}
                                    onPress={() => copyToClipboard(credentials.password, 'Password')}
                                >
                                    <Text style={styles.credentialLabel}>Password:</Text>
                                    <Text style={styles.credentialValue}>{credentials.password}</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <TouchableOpacity
                            style={styles.terminateButton}
                            onPress={() => handleTerminate(activeSession.id)}
                        >
                            <Ionicons name="close-circle" size={16} color="#EF4444" />
                            <Text style={styles.terminateButtonText}>Terminate Session</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.sessionButtons}>
                        <TouchableOpacity
                            style={styles.sessionButton}
                            onPress={() => handleCreateSession('rotating')}
                            disabled={creating}
                        >
                            <Ionicons name="globe" size={32} color="#2563EB" />
                            <Text style={styles.sessionButtonTitle}>Rotating</Text>
                            <Text style={styles.sessionButtonDesc}>New IP each request</Text>
                            {creating && <ActivityIndicator style={{ marginTop: 8 }} />}
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sessionButton}
                            onPress={() => handleCreateSession('sticky')}
                            disabled={creating}
                        >
                            <Ionicons name="shield" size={32} color="#2563EB" />
                            <Text style={styles.sessionButtonTitle}>Sticky</Text>
                            <Text style={styles.sessionButtonDesc}>Same IP persists</Text>
                            {creating && <ActivityIndicator style={{ marginTop: 8 }} />}
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {/* Usage Stats */}
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <Ionicons name="analytics" size={20} color="#6B7280" />
                    <Text style={styles.cardTitle}>Usage</Text>
                </View>
                <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{sessions.length}</Text>
                        <Text style={styles.statLabel}>Active Sessions</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>0 MB</Text>
                        <Text style={styles.statLabel}>Data Today</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>99.9%</Text>
                        <Text style={styles.statLabel}>Success Rate</Text>
                    </View>
                </View>
            </View>

            {/* iOS Proxy Setup Instructions */}
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <Ionicons name="settings" size={20} color="#6B7280" />
                    <Text style={styles.cardTitle}>iOS Proxy Setup</Text>
                </View>
                <Text style={styles.instructionsText}>
                    To use the proxy on your iPhone:{'\n\n'}
                    1. Go to Settings → Wi-Fi{'\n'}
                    2. Tap the (i) next to your network{'\n'}
                    3. Scroll down to HTTP Proxy{'\n'}
                    4. Select "Manual"{'\n'}
                    5. Enter Server: {PROXY_ENDPOINT.split(':')[0]}{'\n'}
                    6. Enter Port: {PROXY_ENDPOINT.split(':')[1]}{'\n'}
                    7. Enable Authentication{'\n'}
                    8. Enter your session credentials
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    content: {
        padding: 16,
        paddingBottom: 32,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#6B7280',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginLeft: 8,
        color: '#111827',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 20,
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
        alignItems: 'center',
        marginBottom: 16,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
        color: '#374151',
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    statusItem: {
        flex: 1,
    },
    statusLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 4,
    },
    statusValue: {
        fontSize: 14,
        fontWeight: '500',
        color: '#2563EB',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    statusBadgeText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#6B7280',
    },
    testButtonText: {
        color: '#FFF',
        fontWeight: '600',
        marginLeft: 8,
    },
    testButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2563EB',
        paddingVertical: 12,
        borderRadius: 8,
        minHeight: 44,
    },
    sessionButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    sessionButton: {
        flex: 1,
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    sessionButtonTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
        marginTop: 8,
    },
    sessionButtonDesc: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    activeSessionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#DCFCE7',
        padding: 12,
        borderRadius: 8,
        marginBottom: 12,
    },
    activeSessionText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#166534',
    },
    activeSessionId: {
        fontSize: 12,
        color: '#16A34A',
    },
    credentialsBox: {
        backgroundColor: '#1F2937',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
    },
    credentialsTitle: {
        fontSize: 12,
        color: '#9CA3AF',
        marginBottom: 8,
    },
    credentialRow: {
        marginBottom: 8,
        paddingVertical: 12,
    },
    credentialLabel: {
        fontSize: 12,
        color: '#6B7280',
    },
    credentialValue: {
        fontSize: 14,
        color: '#FFF',
        fontFamily: 'monospace',
    },
    terminateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#FECACA',
        paddingVertical: 12,
        borderRadius: 8,
    },
    terminateButtonText: {
        color: '#EF4444',
        fontWeight: '600',
        marginLeft: 8,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    statItem: {
        alignItems: 'center',
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#2563EB',
    },
    statLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 4,
    },
    instructionsText: {
        fontSize: 14,
        color: '#374151',
        lineHeight: 22,
    },
});
