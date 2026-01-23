import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import client from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Dashboard() {
    const { user, logout } = useAuth();
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const [wallet, setWallet] = useState<any>(null);
    const insets = useSafeAreaInsets();

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
            {/* Header with gradient backdrop */}
            <View
                className="absolute top-0 left-0 right-0 bg-primary/5 rounded-b-[40px]"
                style={{ height: 160 + insets.top }}
            />

            <View
                className="pb-6 px-6 flex-row justify-between items-center"
                style={{ paddingTop: insets.top + 20 }}
            >
                <View>
                    <View className="flex-row items-center mb-1">
                        <View className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                        <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Active Operator</Text>
                    </View>
                    <Text className="text-3xl font-black text-foreground uppercase tracking-tighter italic">
                        {user?.user_metadata?.display_name || user?.email?.split('@')[0]}
                        <Text className="text-primary">_</Text>
                    </Text>
                </View>
                <TouchableOpacity
                    onPress={logout}
                    className="w-12 h-12 bg-white/50 border border-destructive/20 rounded-2xl items-center justify-center shadow-sm min-w-[44px] min-h-[44px]"
                >
                    <Ionicons name="power" size={20} color="#EF4444" />
                </TouchableOpacity>
            </View>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 24, paddingBottom: 100 + insets.bottom }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#059669" />}
            >
                {/* Main Stats Card - Glassmorphism */}
                <View className="bg-white/40 border border-white/60 p-6 mb-8 rounded-[32px] shadow-sm backdrop-blur-md overflow-hidden">
                    <View className="absolute -top-10 -right-10 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />

                    <View className="flex-row justify-between items-center mb-6">
                        <View className="bg-primary/10 px-3 py-1.5 rounded-full border border-primary/10">
                            <Text className="text-[10px] font-black text-primary uppercase tracking-widest">Financial Core</Text>
                        </View>
                        <View className="bg-primary/10 p-2 rounded-xl">
                            <Ionicons name="stats-chart" size={16} color="#059669" />
                        </View>
                    </View>

                    <View className="flex-row items-baseline">
                        <Text className="text-5xl font-black text-foreground tracking-tighter italic tabular-nums">
                            {wallet ? wallet.balance.toFixed(2) : '0.00'}<Text className="text-primary">_</Text>
                        </Text>
                        <Text className="text-sm font-black text-muted-foreground uppercase tracking-widest ml-2">GHS</Text>
                    </View>

                    <View className="mt-8 pt-6 border-t border-primary/10 flex-row justify-between items-center">
                        <View className="flex-row items-center">
                            <Ionicons name="checkmark-circle" size={14} color="#059669" />
                            <Text className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest ml-1.5">Network Sync</Text>
                        </View>
                        <TouchableOpacity className="bg-primary px-4 py-2 rounded-full min-h-[44px] justify-center">
                            <Text className="text-[9px] font-black text-white uppercase tracking-widest">Withdraw</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Grid Section */}
                <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-4 ml-2">Node Performance</Text>

                <View className="flex-row gap-4 mb-8">
                    <View className="flex-1 bg-white/40 border border-white/60 p-5 rounded-3xl shadow-sm backdrop-blur-md">
                        <View className="w-10 h-10 bg-emerald-50 rounded-2xl items-center justify-center mb-4">
                            <Ionicons name="flash-outline" size={20} color="#059669" />
                        </View>
                        <Text className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Bandwidth</Text>
                        <View className="flex-row items-baseline">
                            <Text className="text-2xl font-black text-foreground tabular-nums">
                                {stats ? stats.total_gb.toFixed(2) : '0.00'}
                            </Text>
                            <Text className="text-[10px] font-bold text-muted-foreground uppercase ml-1">GB</Text>
                        </View>
                    </View>

                    <View className="flex-1 bg-white/40 border border-white/60 p-5 rounded-3xl shadow-sm backdrop-blur-md">
                        <View className="w-10 h-10 bg-emerald-50 rounded-2xl items-center justify-center mb-4">
                            <Ionicons name="receipt-outline" size={20} color="#059669" />
                        </View>
                        <Text className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Expenses</Text>
                        <View className="flex-row items-baseline">
                            <Text className="text-2xl font-black text-foreground tabular-nums">
                                {stats ? stats.total_cost_ghs.toFixed(2) : '0.00'}
                            </Text>
                            <Text className="text-[10px] font-bold text-muted-foreground uppercase ml-1">GHS</Text>
                        </View>
                    </View>
                </View>

                {/* System Terminal Design */}
                <View className="bg-zinc-900 p-5 rounded-3xl shadow-2xl overflow-hidden mb-6">
                    <View className="flex-row items-center gap-2 mb-4">
                        <View className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                        <View className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                        <View className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                        <Text className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Protocol status 0.4.2</Text>
                    </View>

                    <View className="space-y-2">
                        <Text className="text-[11px] font-medium text-zinc-400 leading-5">
                            <Text className="text-emerald-500">{"> "} </Text>
                            AUTHENTICATED AS <Text className="text-emerald-500 font-black">{user?.role?.toUpperCase() || 'OPERATOR'}</Text>
                        </Text>
                        <Text className="text-[11px] font-medium text-emerald-500/80 leading-5 italic">
                            All proxy traffic is routed via the decentralized Mesh Gateway with AES-256-GCM encryption.
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    className="bg-primary/10 border border-primary/20 py-5 rounded-3xl flex-row justify-center items-center active:bg-primary/20 min-h-[56px]"
                    onPress={() => fetchData()}
                >
                    <Ionicons name="reload" size={16} color="#059669" className="mr-3" />
                    <Text className="text-xs font-black text-primary uppercase tracking-widest">Re-Synchronize Nodes</Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
}

