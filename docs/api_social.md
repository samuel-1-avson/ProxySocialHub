# Social Layer – API Contracts

This document wires the **Social Layer** directly into platform APIs.

---

## 1. Profiles

GET /social/profile/{userId}
- Returns public profile, reputation, badges, hardware summary (if provider)

PATCH /social/profile
- Update display name, bio, visibility settings

---

## 2. Friends & Follows

POST /social/friends/request
POST /social/friends/accept
DELETE /social/friends/remove

POST /social/follow/{userId}
DELETE /social/follow/{userId}

---

## 3. Messaging

POST /social/messages/send
GET /social/messages/thread/{threadId}

Message payloads are encrypted client-side.

---

## 4. Clans

POST /social/clans
POST /social/clans/join
POST /social/clans/invite
GET /social/clans/{id}

---

## 5. Rankings & Discovery

GET /social/rankings/providers
GET /social/rankings/clans

GET /social/search?q=&filters=

---

## 6. Provider Transparency

GET /social/providers/{id}/stats
- Aggregated metrics only

