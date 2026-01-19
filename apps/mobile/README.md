# ProxyHub Mobile App

React Native mobile application for ProxyHub proxy network.

## Setup
## Architecture (Expo Router)

The project uses **Expo Router** and **NativeWind** (Tailwind CSS).

```
app/
├── (auth)/         # Public authentication routes
│   └── login.tsx
├── (app)/          # Protected routes (Tabs)
│   ├── dashboard.tsx
│   ├── wallet.tsx
│   └── settings.tsx
├── _layout.tsx     # Root layout (Providers)
└── index.tsx       # Entry point (Router Gate)

src/
├── context/        # React Context (Auth)
└── api/            # API Client
```

## Running the App

```bash
# Start Metro Bundler
npx expo start --clear

# Run on Android Emulator
npx expo run:android

# Run on iOS Simulator
npx expo run:ios
```

## Features

- User authentication (login/register)
- Session management
- Wallet & MoMo payments
- Usage tracking
- Push notifications
- Provider mode (future)
