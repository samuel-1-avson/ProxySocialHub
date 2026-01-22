import { View, Text, StyleSheet } from 'react-native';

export default function Wallet() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>Wallet Coming Soon</Text>
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
    text: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#9CA3AF',
    },
});
