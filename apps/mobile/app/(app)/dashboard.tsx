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
        <View className="flex-1 bg-background">
            <View className="pt-16 pb-6 px-6 bg-card border-b-2 border-border flex-row justify-between items-center">
                <View>
                    <Text className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Operator Status</Text>
                    <Text className="text-2xl font-black text-foreground uppercase tracking-tighter">
                        {user?.user_metadata?.display_name || user?.email?.split('@')[0]}
                    </Text>
                </View>
                <TouchableOpacity onPress={logout} className="p-3 bg-destructive/10 border-2 border-destructive rounded-sm">
                    <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
            </View>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 24 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#059669" />}
            >
                {/* Wallet Card */}
                <View className="bg-primary/5 border-2 border-primary p-6 mb-6 rounded-sm shadow-[4px_4px_0px_#18181B]">
                    <View className="flex-row justify-between items-center mb-4">
                        <Text className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Financial Core</Text>
                        <Ionicons name="wallet-outline" size={18} color="#059669" />
                    </View>
                    <View className="flex-row items-baseline gap-2">
                        <Text className="text-4xl font-black text-foreground tabular-nums">
                            {wallet ? wallet.balance.toFixed(2) : '0.00'}
                        </Text>
                        <Text className="text-xs font-bold text-muted-foreground uppercase tracking-widest">GHS</Text>
                    </View>
                    <Text className="text-[9px] font-bold text-muted-foreground mt-4 uppercase tracking-widest border-t border-primary/20 pt-4">
                        Status: Synchronized with Gateway
                    </Text>
                </View>

                {/* Usage Stats Grid */}
                <View className="flex-row gap-4 mb-6">
                    <View className="flex-1 bg-card border-2 border-border p-4 rounded-sm">
                        <View className="w-10 h-10 bg-secondary border border-border items-center justify-center mb-4">
                            <Ionicons name="cloud-upload-outline" size={20} color="#059669" />
                        </View>
                        <Text className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Data Used</Text>
                        <View className="flex-row items-baseline gap-1">
                            <Text className="text-xl font-black text-foreground tabular-nums">
                                {stats ? stats.total_gb.toFixed(2) : '0.00'}
                            </Text>
                            <Text className="text-[10px] font-bold text-muted-foreground uppercase">GB</Text>
                        </View>
                    </View>

                    <View className="flex-1 bg-card border-2 border-border p-4 rounded-sm">
                        <View className="w-10 h-10 bg-secondary border border-border items-center justify-center mb-4">
                            <Ionicons name="cash-outline" size={20} color="#059669" />
                        </View>
                        <Text className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Est. Cost</Text>
                        <View className="flex-row items-baseline gap-1">
                            <Text className="text-xl font-black text-foreground tabular-nums">
                                {stats ? stats.total_cost_ghs.toFixed(2) : '0.00'}
                            </Text>
                            <Text className="text-[10px] font-bold text-muted-foreground uppercase">GHS</Text>
                        </View>
                    </View>
                </View>

                {/* System Messages */}
                <View className="bg-secondary/50 border-2 border-border p-5 rounded-sm border-dashed">
                    <View className="flex-row items-center gap-3 mb-3">
                        <Ionicons name="information-circle-outline" size={18} color="#71717A" />
                        <Text className="text-[10px] font-black text-foreground uppercase tracking-widest">System Protocols</Text>
                    </View>
                    <Text className="text-xs font-medium text-muted-foreground leading-5 uppercase">
                        Current role: <Text className="font-bold text-primary">{user?.role || 'Operator'}</Text>. All proxy traffic is encrypted via the decentralized node network.
                    </Text>
                </View>

                <TouchableOpacity
                    className="mt-8 bg-foreground p-5 rounded-sm flex-row justify-between items-center shadow-[4px_4px_0px_#059669]"
                    onPress={() => fetchData()}
                >
                    <Text className="text-xs font-black text-background uppercase tracking-widest">Sync Infrastructure</Text>
                    <Ionicons name="refresh" size={16} color="#FDFBF7" />
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

