// Polyfill for Node.js core modules in React Native
import { Buffer } from 'buffer';
import 'react-native-get-random-values';

// Polyfill Buffer
if (typeof global.Buffer === 'undefined') {
    global.Buffer = Buffer;
}

// Polyfill process
if (typeof global.process === 'undefined') {
    global.process = require('process/browser');
}

// Ensure crypto is available globally if needed by some libraries
if (typeof global.crypto === 'undefined') {
    // We can't fully polyfill crypto but some libs check for it
    // expo-crypto handles the implementation
}
