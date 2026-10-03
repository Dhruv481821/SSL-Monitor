# SSL Monitor MCP — REST API Contract

Base path: `/api/v1`. JSON bodies. Protected requests use `Authorization: Bearer <JWT>`.

Common error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "..."
  }
}
```

No stack traces, secrets, SQL errors or raw OpenSSL dumps.

## Authentication

### POST /auth/register

Auth: none.
Request: `{ "email": "user@example.com", "password": "..." }`
Validation: normalized email; valid email; password >= 12 chars.
Response 201: `{ "user": {"id":"uuid","email":"..."}, "token":"jwt" }`
Errors: `VALIDATION_ERROR`, `EMAIL_ALREADY_EXISTS`.

### POST /auth/login

Auth: none.
Request: `{ "email":"...", "password":"..." }`
Response 200: same user/token shape.
Errors: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`.
Strictly rate limited.

### GET /health

Auth: none.
Response 200: `{ "status":"ok" }`.
No secrets.

## Domain management

### POST /domains

Auth: required.
Request: `{ "hostname":"example.com" }`.
Validation: hostname only; normalized; no scheme/path/credentials/port; SSRF policy.
Response 201: domain id, hostname, status, monitoringEnabled, lastCheckedAt, nextCheckAt.
Errors: validation, unsafe target, duplicate.

### GET /domains

Auth: required.
Returns only caller-owned domains with current summary.

### GET /domains/:domainId

Auth: required.
Owner only. Returns domain/current monitoring summary.
Errors: 403/404.

### DELETE /domains/:domainId

Auth: required.
Owner only. Response 204.

### POST /domains/:domainId/check

Auth: required, owner only.
Runs bounded immediate check.
Returns normalized check result:
`id, success, status, checkedAt, validFrom, validUntil, daysRemaining, issuer, subject, dnsNames, tlsVersion, chainValid, chainInfo`.
Errors: not found, forbidden, unsafe target, TLS failure, timeout, rate limit.

### GET /domains/:domainId/ssl

Auth: required, owner only.
Returns latest/current SSL status.

### GET /domains/:domainId/certificate

Auth: required, owner only.
Returns normalized certificate fields from latest successful check.

### GET /domains/:domainId/history

Auth: required, owner only.
Query `limit` 1–100, optional cursor/timestamp.
Returns newest-first history.

## Alerts/settings

### GET /alerts

Auth: required.
Returns caller-owned alerts. Optional `state=open|resolved`, `limit` 1–100.

### GET /notification-settings

Auth: required.
Returns caller settings with sensitive data redacted as appropriate.

### PUT /notification-settings

Auth: required.
Request:

```json
{
  "emailEnabled": false,
  "emailAddress": null,
  "webhookEnabled": true,
  "webhookUrl": "https://hooks.example.com/...",
  "expiryThresholdDays": [30, 14, 7, 1]
}
```

Validation: email syntax; positive bounded thresholds; HTTPS webhook; webhook destination passes SSRF policy.
Response 200: normalized settings.

## Authorization

Every protected request resolves one user identity. Domain/alert/settings resources must belong to that user. Client-supplied user IDs never determine authorization.

## Rate limiting

Strict login/registration limits; per-user/IP limits on domain creation/manual checks; general API limit; separate MCP limit.

## HTTP status conventions

400 validation; 401 authentication; 403 ownership/authorization; 404 missing resource; 409 conflict; 422 unsafe semantic target; 429 rate limit; 500 sanitized internal error; 502 upstream TLS/network failure; 504 check timeout.
