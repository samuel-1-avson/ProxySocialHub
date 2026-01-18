# Real-Time Chat Architecture

## Transport Options

### WebSocket (Primary)
- Persistent connection
- Ideal for DMs and clan chats

### WebRTC (Optional – Future)
- Peer-to-peer for voice or screenshare

---

## Architecture

Client → API Gateway → Chat Service → Redis Streams

Messages:
- Encrypted client-side
- Stored temporarily (TTL)

---

## Features
- Typing indicators
- Online presence
- Rate limiting
- Abuse detection

---

## Security
- End-to-end encryption
- No plaintext storage
- Auto-expiring threads

