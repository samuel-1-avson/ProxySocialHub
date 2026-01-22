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
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
                <View className="items-center mb-12">
                    <View className="w-20 h-20 bg-primary/10 border-4 border-primary rounded-sm items-center justify-center mb-6 shadow-[4px_4px_0px_#18181B]">
                        <Ionicons name="shield-half" size={40} color="#059669" />
                    </View>
                    <Text className="text-4xl font-black text-foreground uppercase tracking-tighter">Access_Gate</Text>
                    <Text className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em] mt-2">Operator Identity Verification</Text>
                </View>

                <View className="space-y-4">
                    <View>
                        <Text className="text-[10px] font-black text-muted-foreground uppercase mb-2 tracking-widest ml-1">Identity_Handle</Text>
                        <TextInput
                            className="bg-card border-2 border-border p-4 rounded-sm text-foreground font-bold"
                            placeholder="operator@proxyhubb.net"
                            placeholderTextColor="#A1A1AA"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />
                    </View>

                    <View>
                        <Text className="text-[10px] font-black text-muted-foreground uppercase mb-2 tracking-widest ml-1">Encryption_Key</Text>
                        <TextInput
                            className="bg-card border-2 border-border p-4 rounded-sm text-foreground font-bold"
                            placeholder="••••••••"
                            placeholderTextColor="#A1A1AA"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />
                    </View>

                    <TouchableOpacity
                        className="bg-primary p-5 rounded-sm mt-6 shadow-[4px_4px_0px_#18181B] flex-row justify-center items-center"
                        onPress={handleLogin}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <>
                                <Text className="text-white font-black uppercase tracking-widest mr-2">Authenticate</Text>
                                <Ionicons name="arrow-forward" size={18} color="#FFF" />
                            </>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity className="mt-8 items-center">
                        <Text className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                            Forgot encryption key? <Text className="text-primary font-black underline">Request_Reset</Text>
                        </Text>
                    </TouchableOpacity>
                </View>

                <View className="mt-20 border-t border-border/30 pt-8 flex-row justify-center items-center gap-4">
                    <View className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <Text className="text-[8px] font-black text-muted-foreground uppercase tracking-[0.2em]">Encrypted Connection Active</Text>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
