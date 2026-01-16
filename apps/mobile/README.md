# ProxyHub Mobile App

React Native mobile application for ProxyHub proxy network.

## Setup

```bash
# Install dependencies
npm install

# iOS
npx pod-install ios
npm run ios

# Android
npm run android
```

## Features

- User authentication (login/register)
- Session management
- Wallet & MoMo payments
- Usage tracking
- Push notifications
- Provider mode (future)

## Project Structure

```
src/
├── components/     # Reusable UI components
├── screens/        # Screen components
├── navigation/     # Navigation configuration
├── services/       # API services
├── hooks/          # Custom hooks
├── store/          # State management
├── utils/          # Utility functions
└── types/          # TypeScript types
```
