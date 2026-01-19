import { View, Text, TouchableOpacity } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';

export default function Settings() {
    const { logout } = useAuth();

    return (
        <View className="flex-1 justify-center items-center bg-gray-50">
            <Text className="text-xl font-bold text-gray-400 mb-4">Settings Coming Soon</Text>
            <TouchableOpacity onPress={logout} className="bg-red-500 px-6 py-3 rounded-xl">
                <Text className="text-white font-bold">Logout</Text>
            </TouchableOpacity>
        </View>
    );
}
