import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import client from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';

export default function Dashboard() {
    const { user, logout } = useAuth();
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const [wallet, setWallet] = useState<any>(null);

    const fetchData = async () => {
        try {
            const [usageRes, walletRes] = await Promise.all([
                client.get('/usage/me').catch(e => ({ data: null })),
                client.get('/wallet').catch(e => ({ data: null }))
            ]);

            if (usageRes.data) setStats(usageRes.data);
            if (walletRes.data) setWallet(walletRes.data);
        } catch (error) {
            console.log('Error fetching dashboard data', error);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchData();
        setRefreshing(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.welcomeText}>Welcome back</Text>
                    <Text style={styles.userName}>{user?.user_metadata?.display_name || user?.email?.split('@')[0]}</Text>
                </View>
                <TouchableOpacity onPress={logout} style={styles.logoutButton}>
                    <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                {/* Wallet Card */}
                <View style={styles.walletCard}>
                    <View style={styles.walletHeader}>
                        <Text style={styles.walletHeaderLabel}>Total Balance</Text>
                        <Ionicons name="wallet-outline" size={20} color="rgba(255,255,255,0.7)" />
                    </View>
                    <Text style={styles.balanceText}>
                        GHS {wallet ? wallet.balance.toFixed(2) : '...'}
                    </Text>
                    <Text style={styles.walletFooter}>Available for withdrawal</Text>
                </View>

                {/* Usage Stats Grid */}
                <View style={styles.statsGrid}>
                    <View style={styles.statCard}>
                        <View style={[styles.iconContainer, styles.greenBg]}>
                            <Ionicons name="cloud-upload-outline" size={20} color="#10B981" />
                        </View>
                        <Text style={styles.statLabel}>Data Used</Text>
                        <Text style={styles.statValue}>
                            {stats ? stats.total_gb.toFixed(2) : '0.00'} <Text style={styles.unitText}>GB</Text>
                        </Text>
                    </View>

                    <View style={styles.statCard}>
                        <View style={[styles.iconContainer, styles.purpleBg]}>
                            <Ionicons name="cash-outline" size={20} color="#8B5CF6" />
                        </View>
                        <Text style={styles.statLabel}>Est. Cost</Text>
                        <Text style={styles.statValue}>
                            {stats ? `GHS ${stats.total_cost_ghs.toFixed(2)}` : '0.00'}
                        </Text>
                    </View>
                </View>

                {/* Active Plan Info */}
                <View style={styles.planCard}>
                    <View style={styles.planHeader}>
                        <Ionicons name="shield-checkmark-outline" size={18} color="#4B5563" />
                        <Text style={styles.planTitle}>Current Plan</Text>
                    </View>
                    <Text style={styles.planDescription}>
                        You are currently subscribed to the <Text style={styles.planName}>{user?.role}</Text> plan.
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        paddingTop: 64,
        paddingBottom: 24,
        paddingHorizontal: 24,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    welcomeText: {
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '500',
    },
    userName: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    logoutButton: {
        padding: 8,
        backgroundColor: '#FEF2F2',
        borderRadius: 20,
    },
    scrollContent: {
        padding: 24,
    },
    walletCard: {
        backgroundColor: '#2563EB',
        borderRadius: 16,
        padding: 24,
        marginBottom: 24,
        shadowColor: '#BFDBFE',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
    walletHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    walletHeaderLabel: {
        color: '#DBEAFE',
        fontWeight: '500',
        fontSize: 14,
    },
    balanceText: {
        fontSize: 36,
        fontWeight: 'bold',
        color: '#FFFFFF',
        marginBottom: 8,
    },
    walletFooter: {
        color: '#BFDBFE',
        fontSize: 12,
    },
    statsGrid: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 24,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#F3F4F6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    greenBg: {
        backgroundColor: '#ECFDF5',
    },
    purpleBg: {
        backgroundColor: '#F5F3FF',
    },
    statLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 4,
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    unitText: {
        fontSize: 14,
        fontWeight: 'normal',
        color: '#9CA3AF',
    },
    planCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    planHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    planTitle: {
        color: '#111827',
        fontWeight: '600',
        marginLeft: 8,
    },
    planDescription: {
        color: '#6B7280',
        lineHeight: 20,
    },
    planName: {
        fontWeight: 'bold',
        color: '#2563EB',
        textTransform: 'capitalize',
    },
});
