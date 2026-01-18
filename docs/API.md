# ProxySocialHub API Documentation

This document references the actual implementation of the Control API.

## Base URL
`/v1` for public and protected routes.

## Authentication
All protected routes require a Bearer Token (JWT) or an API Key.

### Endpoints

#### Auth (`/v1/auth`)
- **POST** `/auth/register`
  - Body: `{ "email": "user@example.com", "password": "...", "role": "buyer|provider" }`
- **POST** `/auth/login`
  - Body: `{ "email": "...", "password": "..." }`
- **POST** `/auth/refresh`
  - Body: `{ "refresh_token": "..." }`
- **POST** `/auth/verify-email`
  - Body: `{ "token": "..." }`
- **POST** `/auth/resend-verification`
  - Body: `{ "email": "..." }`
- **POST** `/auth/2fa/verify`
  - Body: `{ "temp_token": "...", "code": "123456" }`

#### Sessions (`/v1/sessions`) _(Protected)_
- **POST** `/sessions/`
  - Create a new proxy session.
  - Body: `{ "type": "rotating|sticky", "bandwidth_limit": 1000, "target_geo": "GH", "target_isp": "Vodafone" }`
- **GET** `/sessions/`
  - List all active and past sessions.
- **GET** `/sessions/:id`
  - Get details and usage for a specific session.
- **POST** `/sessions/:id/terminate`
  - Stop a session immediately.

#### Usage (`/v1/usage`) _(Protected)_
- **POST** `/usage/report`
  - Report usage (Internal/Gateway use).
- **GET** `/usage/session/:session_id`
  - Get real-time usage for a session.
- **GET** `/usage/me`
  - Get aggregated usage for the current user.

#### Wallet (`/v1/wallet`) _(Protected)_
- **GET** `/wallet/balance`
  - Get current balance.
- **POST** `/wallet/topup`
  - Inititate a top-up (e.g., Paystack/Stripe).
- **GET** `/wallet/transactions`
  - List transaction history.

#### Social & Marketplace
- **Profiles** (`/v1/profiles`)
  - GET/PUT profile information.
- **Listings** (`/v1/listings`)
  - **GET** `/listings`: Search and filter proxy listings.
  - **POST** `/listings`: Create a new listing (Provider only).
- **Orders** (`/v1/orders`)
  - Purchase bandwidth from a listing.
- **Smart Matching** (`/v1/matching`)
  - **GET** `/matching/recommend`: Get AI-driven recommendations based on preferences.
  - **GET** `/matching/use-cases`: List available use cases (e.g., "Web Scraping", "Social Media Management").
  - **PUT** `/matching/preferences`: Update matching preferences.

#### Admin (`/v1/admin`) _(Admin Role Required)_
- **GET** `/admin/kyc/pending`: View pending KYC requests.
- **POST** `/admin/kyc/:id/approve`: Approve KYC.
- **POST** `/admin/kyc/:id/reject`: Reject KYC.

## Error Handling
Responses use standard HTTP status codes:
- `200 OK`: Success
- `400 Bad Request`: Validation error
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Insufficient permissions (e.g., KYC required)
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server-side issue

## Rate Limiting
Endpoints are rate-limited via Redis. Headers `X-RateLimit-Limit` and `X-RateLimit-Remaining` are returned.
