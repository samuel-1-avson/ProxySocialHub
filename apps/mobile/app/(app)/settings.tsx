import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';

export default function Settings() {
    const { logout } = useAuth();

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Settings Coming Soon</Text>
            <TouchableOpacity onPress={logout} style={styles.logoutButton}>
                <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F9FAFB',
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#9CA3AF',
        marginBottom: 16,
    },
    logoutButton: {
        backgroundColor: '#EF4444',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
    },
    logoutText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: 16,
    },
});
