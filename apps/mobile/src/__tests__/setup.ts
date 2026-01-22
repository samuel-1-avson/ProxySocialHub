// Mock crypto libraries first
jest.mock('react-native-get-random-values', () => {});

// Mock React Native modules
jest.mock('react-native', () => {
    const RN = jest.requireActual('react-native');
    return {
        ...RN,
        Alert: {
            alert: jest.fn(),
        },
        Platform: {
            OS: 'ios',
        },
    };
});

// Mock Expo modules
jest.mock('expo-router', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
    }),
    useLocalSearchParams: () => ({}),
}));

jest.mock('expo-linking', () => ({
    createURL: jest.fn((path: string) => `proxyhub://${path}`),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-web-browser', () => ({
    openAuthSessionAsync: jest.fn(),
    openBrowserAsync: jest.fn(),
    maybeCompleteAuthSession: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({
    appOwnership: 'standalone',
}));

// Mock vector icons
jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    FontAwesome5: 'FontAwesome5',
}));

// Mock crypto libraries
jest.mock('bs58', () => ({
    encode: jest.fn(() => 'encoded-key'),
    decode: jest.fn(() => new Uint8Array()),
}));

jest.mock('tweetnacl', () => ({
    box: {
        keyPair: jest.fn(() => ({
            publicKey: new Uint8Array(32),
            secretKey: new Uint8Array(32),
        })),
    },
}));

// Mock network info
jest.mock('@react-native-community/netinfo', () => ({
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

// Global test timeout
jest.setTimeout(10000);