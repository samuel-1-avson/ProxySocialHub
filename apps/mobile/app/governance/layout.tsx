import { Stack } from 'expo-router';

export default function GovernanceLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'white' },
            }}
        />
    );
}
