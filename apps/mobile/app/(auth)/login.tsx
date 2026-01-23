import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import client from '../../src/api/client';
import { Ionicons } from '@expo/vector-icons';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { login } = useAuth();

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Protocol Error', 'Please fill in all decryption fields');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await client.post('/auth/login', {
                email,
                password,
            });

            const { token, user } = response.data;
            await login(token, user);
        } catch (error: any) {
            console.log(error);
            const message = error.response?.data?.error || 'Authorization failed';
            Alert.alert('Access Denied', message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1 bg-background"
        >
            <View className="absolute top-0 left-0 right-0 h-64 bg-primary/5 rounded-b-[40px]" />

            <ScrollView
                contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
                showsVerticalScrollIndicator={false}
            >
                <View className="items-center mb-10">
                    <View className="w-24 h-24 bg-white/80 border-2 border-primary/20 rounded-2xl items-center justify-center mb-6 shadow-xl overflow-hidden">
                        <View className="absolute inset-0 bg-primary/10 opacity-50" />
                        <Ionicons name="shield-checkmark" size={48} color="#059669" />
                    </View>

                    <View className="items-center">
                        <Text className="text-5xl font-black text-foreground uppercase tracking-tighter italic">
                            Access<Text className="text-primary italic">_</Text>Gate
                        </Text>
                        <View className="flex-row items-center mt-2 bg-primary/10 px-3 py-1 rounded-full">
                            <View className="w-1.5 h-1.5 rounded-full bg-primary mr-2" />
                            <Text className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">
                                Identity Verification Protocol
                            </Text>
                        </View>
                    </View>
                </View>

                <View className="bg-white/40 border border-white/60 p-6 rounded-3xl shadow-sm backdrop-blur-md">
                    <View className="space-y-6">
                        <View>
                            <View className="flex-row justify-between items-center mb-2 px-1">
                                <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Identity_Handle</Text>
                                <Ionicons name="person-outline" size={12} color="#71717A" />
                            </View>
                            <TextInput
                                className="bg-white/50 border-2 border-border/50 p-4 rounded-xl text-foreground font-bold text-lg"
                                placeholder="operator@proxyhubb.net"
                                placeholderTextColor="#A1A1AA"
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                            />
                        </View>

                        <View className="mt-4">
                            <View className="flex-row justify-between items-center mb-2 px-1">
                                <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Encryption_Key</Text>
                                <Ionicons name="key-outline" size={12} color="#71717A" />
                            </View>
                            <TextInput
                                className="bg-white/50 border-2 border-border/50 p-4 rounded-xl text-foreground font-bold text-lg"
                                placeholder="••••••••"
                                placeholderTextColor="#A1A1AA"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                            />
                        </View>

                        <TouchableOpacity
                            className="bg-primary p-5 rounded-2xl mt-8 shadow-lg active:opacity-90 flex-row justify-center items-center overflow-hidden"
                            onPress={handleLogin}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Text className="text-white font-black uppercase tracking-widest text-lg mr-2">Authenticate</Text>
                                    <View className="bg-white/20 p-1 rounded-full">
                                        <Ionicons name="finger-print" size={20} color="#FFF" />
                                    </View>
                                </>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity className="mt-6 items-center py-2">
                            <Text className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                Lost Access? <Text className="text-primary font-black">Initiate Recovery</Text>
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <View className="mt-12 items-center">
                    <View className="bg-card/50 px-4 py-2 rounded-full border border-border/50 flex-row items-center">
                        <View className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-2" />
                        <Text className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.1em]">
                            AES-256 Link Active • v1.0.4-stable
                        </Text>
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
