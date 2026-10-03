# SSL Monitor MCP — Security Model

## Threat model

User-controlled hostnames trigger outbound DNS/TLS connections. The primary security objective is to prevent the service from becoming an SSRF/network-proxy primitive while isolating user resources and bounding resource consumption.

## Authentication

- Email/password.
- Argon2id password hashes.
- Short-lived signed JWT access tokens.
- Strong random JWT secret from deployment secret storage.
- Generic invalid-credential response.
- Login/registration rate limits.
- No passwords/tokens in logs.

## Authorization and isolation

Every protected request resolves one identity.

```text
authenticated user == resource.user_id
```

MCP keys map to one user. No caller-supplied user ID can override identity.

## Domain input

Accept hostname only. Reject:

- schemes/paths/credentials/fragments;
- explicit ports;
- malformed names;
- localhost/local/internal names;
- IP literals.

Normalize before persistence/uniqueness comparison.

## SSRF control

1. Normalize hostname.
2. Resolve DNS with controlled logic.
3. Validate every returned address.
4. Reject unsafe destinations.
5. Connect using a validated resolved address.
6. Preserve original hostname as TLS SNI.
7. Verify certificate hostname against the original hostname.
8. Do not perform an uncontrolled second DNS lookup after validation.

## Blocked destinations

Reject at minimum:

- localhost names;
- IPv4 `127.0.0.0/8`, `0.0.0.0/8`;
- RFC1918 IPv4 ranges;
- `169.254.0.0/16`;
- IPv6 `::1`, `::`;
- IPv6 unique-local `fc00::/7`;
- IPv6 link-local `fe80::/10`;
- IPv4-mapped IPv6 containing blocked IPv4;
- multicast/reserved/non-global destinations;
- CGNAT `100.64.0.0/10` as a conservative abuse-control measure.

Use centralized numeric IP-range checks with regression tests; do not use string-prefix matching for network classification.

## DNS rebinding

Resolve once under controlled logic, validate returned addresses, then use the validated address through the TLS connection's lookup mechanism. Retain the original hostname for SNI and certificate verification. Each later scheduled check repeats validation.

Mixed public/private DNS answers are rejected: if any resolved address is blocked, the entire resolution is rejected. This is the conservative MVP posture and prevents selecting a safe-looking answer from an unsafe answer set.

## Protocol/port

Hostname-only HTTPS monitoring. Port 443 only. No redirects or HTTP content fetching.

## Time/resource controls

- hard DNS timeout;
- hard TLS handshake timeout;
- bounded worker concurrency;
- bounded worker batch;
- manual-check rate limit;
- bounded pagination;
- no application-body downloads.

## Rate limits

At minimum:

- strict login/registration;
- per-user/IP add-domain;
- per-user/IP manual checks;
- per-key/user MCP requests;
- general API rate limit.

Exact numeric values are implementation parameters.

## MCP API keys

Cryptographically random, raw key shown once, hash-only storage, optional expiry, revocation, no full-key logging.

## Webhooks

HTTPS only; destination validated against SSRF policy; bounded timeout; bounded response handling; secrets in URLs are never logged; notification failure does not block monitoring.

## Logging

Log request/tool ID, request ID, user ID where appropriate, domain ID, safe error code and timing/status.
Never log passwords, JWTs, MCP keys, DB URLs, webhook credentials or raw internal error dumps in user-facing responses.

## Error handling

Expose stable safe error codes/messages. Do not return raw OpenSSL, SQL, DNS topology, filesystem or secret information.

## Security acceptance gate

Before Phase 03 is considered complete:

- local/private/link-local IPv4 rejected;
- local/private/link-local IPv6 rejected;
- DNS rebinding test passes;
- TLS timeout enforced;
- cross-user access denied;
- API/MCP rate limits active;
- credentials/keys absent from logs;
- malformed input cannot cause arbitrary network connections.
