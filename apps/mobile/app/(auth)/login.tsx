import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        setIsSubmitting(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            // Router redirection is handled by app/index.tsx effect
        } catch (error: any) {
            console.log(error);
            Alert.alert('Login Error', error.message || 'Login failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <View className="flex-1 justify-center p-6 bg-white">
            <View className="mb-10">
                <Text className="text-4xl font-bold text-center text-gray-900 mb-2">ProxyHub</Text>
                <Text className="text-lg text-center text-gray-500">Sign in to your account</Text>
            </View>

            <View className="space-y-4">
                <TextInput
                    className="h-12 border border-gray-200 rounded-xl px-4 text-base bg-gray-50"
                    placeholder="Email"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholderTextColor="#9CA3AF"
                />

                <TextInput
                    className="h-12 border border-gray-200 rounded-xl px-4 text-base bg-gray-50"
                    placeholder="Password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    placeholderTextColor="#9CA3AF"
                />

                <TouchableOpacity
                    className={`h-12 bg-blue-600 rounded-xl justify-center items-center mt-4 ${isSubmitting ? 'opacity-70' : ''}`}
                    onPress={handleLogin}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text className="text-white text-lg font-semibold">Sign In</Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}
