# Real-Time Chat Architecture

## Transport
- WebSocket (primary)
- WebRTC (optional P2P)

---

## Components
- Chat Gateway
- Presence Service
- Message Broker (NATS / Redis)

---

## Flow
1. Client connects via WS
2. Auth via JWT
3. Messages published to broker
4. Fan-out to recipients

---

## Features
- Typing indicators
- Read receipts
- Clan channels

---

## Security
- Rate limiting
- Message size caps
- Abuse detection

