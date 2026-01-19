import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import client from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';

export default function Agents() {
    const [agents, setAgents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchAgents = async () => {
        try {
            const response = await client.get('/agents');
            setAgents(response.data || []);
        } catch (error) {
            console.log('Error fetching agents', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        fetchAgents();
    };

    if (loading) {
        return (
            <View className="flex-1 justify-center items-center bg-white">
                <ActivityIndicator size="large" color="#2563EB" />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-gray-50">
            <View className="pt-16 pb-6 px-6 bg-white border-b border-gray-100 shadow-sm">
                <Text className="text-2xl font-bold text-gray-900">Agent Marketplace</Text>
                <Text className="text-gray-500 text-sm mt-1">Deploy autonomous AI agents</Text>
            </View>

            <ScrollView
                contentContainerStyle={{ padding: 20 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                {agents.length === 0 ? (
                    <View className="items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                        <Ionicons name="hardware-chip-outline" size={48} color="#D1D5DB" />
                        <Text className="text-gray-400 mt-4 font-medium">No agents available yet</Text>
                    </View>
                ) : (
                    agents.map((agent) => (
                        <View key={agent.id} className="bg-white rounded-2xl p-5 mb-4 border border-gray-100 shadow-sm">
                            <View className="flex-row justify-between items-start mb-3">
                                <View className="bg-blue-50 p-2 rounded-xl">
                                    <Ionicons name="hardware-chip-outline" size={24} color="#2563EB" />
                                </View>
                                <View className="bg-gray-100 px-2 py-1 rounded-md">
                                    <Text className="text-[10px] text-gray-500 font-bold">v{agent.version}</Text>
                                </View>
                            </View>

                            <Text className="text-lg font-bold text-gray-900 mb-1">{agent.name}</Text>
                            <Text className="text-gray-500 text-sm mb-4 leading-5" numberOfLines={2}>
                                {agent.description || 'No description provided.'}
                            </Text>

                            <View className="flex-row justify-between items-center pt-4 border-t border-gray-50">
                                <View>
                                    <Text className="text-[10px] text-gray-400 uppercase font-bold">Cost per run</Text>
                                    <Text className="text-blue-600 font-bold">{agent.price_per_run} TAO</Text>
                                </View>
                                <TouchableOpacity className="bg-blue-600 px-5 py-2 rounded-xl">
                                    <Text className="text-white font-bold text-sm">Deploy</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>
        </View>
    );
}
