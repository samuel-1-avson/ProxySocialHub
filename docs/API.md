# ProxyHub Control API Documentation

## Base URL
```
http://localhost:8080/v1
```

## Authentication

### JWT Authentication
Include access token in Authorization header:
```
Authorization: Bearer <access_token>
```

### API Key Authentication
Use API keys for programmatic access:
```
Authorization: Bearer pk_xxx...
# or
X-API-Key: pk_xxx...
```

---

## Auth Endpoints

### POST /auth/register
Register a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "role": "buyer" // or "provider"
}
```

**Response (201):**
```json
{
  "message": "Registration successful. Please verify your email.",
  "verification_required": true
}
```

---

### POST /auth/login
Authenticate user and get tokens.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response - Standard (200):**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "expires_in": 3600,
  "user": { "id": "uuid", "email": "...", "role": "buyer" }
}
```

**Response - 2FA Required (200):**
```json
{
  "requires_2fa": true,
  "temp_token": "eyJhbGc..."
}
```

**Response - Email Not Verified (400):**
```json
{
  "error": "Email not verified",
  "code": "email_not_verified",
  "verification_required": true
}
```

---

### POST /auth/verify-email
Verify email with token from email.

**Request:**
```json
{
  "token": "verification_token_from_email"
}
```

---

### POST /auth/resend-verification
Resend verification email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

---

### POST /auth/2fa/verify
Complete login with 2FA code.

**Request:**
```json
{
  "temp_token": "temp_token_from_login",
  "code": "123456" // or backup code like "12345678"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "user": { ... }
}
```

---

## 2FA Endpoints

All require JWT authentication.

### POST /2fa/setup
Generate TOTP secret and QR code.

**Response (200):**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qr_code": "data:image/png;base64,...",
  "otpauth_url": "otpauth://totp/ProxyHub:user@example.com?..."
}
```

---

### POST /2fa/enable
Enable 2FA after verifying code from authenticator app.

**Request:**
```json
{
  "code": "123456"
}
```

**Response (200):**
```json
{
  "enabled": true,
  "backup_codes": ["12345678", "..."] // 10 codes, save these!
}
```

---

### POST /2fa/disable
Disable 2FA.

**Request:**
```json
{
  "password": "your_password",
  "code": "123456"
}
```

---

### GET /2fa/backup-codes
Get count of remaining backup codes.

**Response:**
```json
{
  "remaining_codes": 8
}
```

---

### POST /2fa/backup-codes/regenerate
Generate new backup codes (invalidates old ones).

**Response:**
```json
{
  "backup_codes": ["12345678", "..."],
  "count": 10
}
```

---

## API Keys Endpoints

All require JWT authentication.

### GET /api-keys
List all API keys for the user.

**Response:**
```json
{
  "api_keys": [
    {
      "id": "uuid",
      "name": "Production",
      "key_prefix": "pk_live_abc123",
      "permissions": ["read", "proxy"],
      "rate_limit_per_minute": 100,
      "created_at": "2026-01-15T...",
      "last_used_at": "2026-01-15T..."
    }
  ],
  "count": 1
}
```

---

### POST /api-keys
Create a new API key.

**Request:**
```json
{
  "name": "Production Server",
  "permissions": ["read", "write", "proxy"],
  "rate_limit_per_minute": 100,
  "expires_in_days": 365 // optional
}
```

**Response (201):**
```json
{
  "api_key": {
    "id": "uuid",
    "name": "Production Server",
    "key": "pk_live_abc123xyz...", // ONLY SHOWN ONCE!
    "key_prefix": "pk_live_abc123",
    "permissions": ["read", "write", "proxy"],
    "rate_limit_per_minute": 100
  },
  "warning": "Store this key securely. You will not be able to see it again."
}
```

---

### DELETE /api-keys/:id
Revoke an API key.

---

### PATCH /api-keys/:id
Update API key settings.

**Request:**
```json
{
  "name": "New Name",
  "permissions": ["read"],
  "rate_limit_per_minute": 50
}
```

---

## Rate Limiting

API keys are subject to per-key rate limits. Response headers:
```
X-RateLimit-Limit: 100       // max requests per minute
X-RateLimit-Remaining: 95    // requests remaining
X-RateLimit-Reset: 1705123456 // unix timestamp when limit resets
```

**Rate Limit Exceeded (429):**
```json
{
  "error": "Rate limit exceeded",
  "code": "rate_limit_exceeded",
  "limit": 100,
  "retry_after": 60
}
```

---

## Admin Endpoints

All require admin role.

### GET /admin/stats
System overview statistics.

### GET /admin/stats/dashboard
Enhanced dashboard with time-based metrics.

### GET /admin/users
List all users with pagination.

### POST /admin/users/:id/ban
Ban a user.

### POST /admin/users/:id/unban
Unban a user.

### POST /admin/users/:id/suspend
Suspend a user temporarily.

### POST /admin/users/:id/activate
Activate a user.

### GET /admin/audit-logs
Query audit logs.

**Query params:**
- `page` - Page number (default: 1)
- `per_page` - Results per page (default: 50, max: 100)
- `action` - Filter by action type
- `entity` - Filter by entity type
- `actor_id` - Filter by actor

---

## Health Monitoring Endpoints

Require admin role.

### GET /admin/health/nodes
List all nodes with health status.

**Query params:**
- `status` - Filter: `healthy`, `unhealthy`

### GET /admin/health/nodes/:id
Detailed node health with recent events.

### POST /admin/health/nodes/:id/check
Trigger manual health check.

### POST /admin/health/nodes/:id/reactivate
Reactivate an unhealthy node.

### GET /admin/health/stats
Aggregate health statistics.

**Response:**
```json
{
  "total_nodes": 100,
  "healthy_nodes": 95,
  "unhealthy_nodes": 5,
  "healthy_percent": 95.0,
  "avg_latency_ms": 45.2
}
```

---

## Wallet Endpoints

### POST /wallet/withdraw
Withdraw funds (requires 2FA if enabled).

**Request:**
```json
{
  "amount": 50.00,
  "method": "mobile_money",
  "mobile_number": "+233...",
  "totp_code": "123456" // required if 2FA enabled
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `email_not_verified` | Email verification required |
| `invalid_credentials` | Wrong email or password |
| `2fa_required` | 2FA verification needed |
| `invalid_totp_code` | Wrong 2FA code |
| `invalid_api_key` | API key not found |
| `api_key_expired` | API key has expired |
| `api_key_revoked` | API key was revoked |
| `rate_limit_exceeded` | Too many requests |
| `permission_denied` | Insufficient permissions |
