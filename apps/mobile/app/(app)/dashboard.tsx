import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
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
        <View className="flex-1 bg-gray-50">
            <View className="pt-16 pb-6 px-6 bg-white border-b border-gray-100 flex-row justify-between items-center shadow-sm">
                <View>
                    <Text className="text-sm text-gray-500 font-medium">Welcome back</Text>
                    <Text className="text-xl font-bold text-gray-900">{user?.display_name || user?.email?.split('@')[0]}</Text>
                </View>
                <TouchableOpacity onPress={logout} className="p-2 bg-red-50 rounded-full">
                    <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={{ padding: 24 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                {/* Wallet Card */}
                <View className="bg-blue-600 rounded-2xl p-6 mb-6 shadow-lg shadow-blue-200">
                    <View className="flex-row justify-between items-center mb-4">
                        <Text className="text-blue-100 font-medium text-sm">Total Balance</Text>
                        <Ionicons name="wallet-outline" size={20} color="rgba(255,255,255,0.7)" />
                    </View>
                    <Text className="text-4xl font-bold text-white mb-2">
                        GHS {wallet ? wallet.balance.toFixed(2) : '...'}
                    </Text>
                    <Text className="text-blue-200 text-xs">Available for withdrawal</Text>
                </View>

                {/* Usage Stats Grid */}
                <View className="flex-row gap-4 mb-6">
                    <View className="flex-1 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                        <View className="bg-green-50 w-10 h-10 rounded-full items-center justify-center mb-3">
                            <Ionicons name="cloud-upload-outline" size={20} color="#10B981" />
                        </View>
                        <Text className="text-gray-500 text-xs mb-1">Data Used</Text>
                        <Text className="text-2xl font-bold text-gray-900">
                            {stats ? stats.total_gb.toFixed(2) : '0.00'} <Text className="text-sm font-normal text-gray-400">GB</Text>
                        </Text>
                    </View>

                    <View className="flex-1 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                        <View className="bg-purple-50 w-10 h-10 rounded-full items-center justify-center mb-3">
                            <Ionicons name="cash-outline" size={20} color="#8B5CF6" />
                        </View>
                        <Text className="text-gray-500 text-xs mb-1">Est. Cost</Text>
                        <Text className="text-2xl font-bold text-gray-900">
                            {stats ? `GHS ${stats.total_cost_ghs.toFixed(2)}` : '0.00'}
                        </Text>
                    </View>
                </View>

                {/* Active Plan Info */}
                <View className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                    <View className="flex-row items-center mb-2">
                        <Ionicons name="shield-checkmark-outline" size={18} color="#4B5563" />
                        <Text className="text-gray-900 font-semibold ml-2">Current Plan</Text>
                    </View>
                    <Text className="text-gray-500 leading-5">
                        You are currently subscribed to the <Text className="font-bold text-blue-600 capitalize">{user?.role}</Text> plan.
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
}
