# SSL Monitor MCP — Architecture Decisions

## ADR-001 — Greenfield

Accepted. SSL Monitor is implemented from scratch.

## ADR-002 — Shared business services

Accepted. Dashboard, REST API, MCP and worker use the same domain/application services.

## ADR-003 — Node TLS

Accepted. Node.js TLS APIs are the authoritative SSL inspection mechanism.

## ADR-004 — PostgreSQL/Neon

Accepted. PostgreSQL on Neon is the managed database target.

## ADR-005 — Fastify + TypeScript

Accepted. Fastify is the API framework and TypeScript is used across application code.

## ADR-006 — Zod

Accepted. Zod handles runtime input/configuration validation.

## ADR-007 — Official TypeScript MCP SDK

Accepted. MCP is an interface adapter over shared services.

## ADR-008 — Worker

Accepted. Scheduled checks run in a separate worker/polling process.

## ADR-009 — No certificate table

Accepted. Certificate snapshots belong to `ssl_checks`; a separate certificate entity is unnecessary for MVP.

## ADR-010 — JWT without refresh subsystem

Accepted. Short-lived JWT access tokens keep the MVP small. Refresh/session storage is deferred.

## ADR-011 — User-scoped MCP API keys

Accepted. Random API keys are hashed and map to exactly one user.

## ADR-012 — Hostname-only, port 443

Accepted. MVP does not accept arbitrary URLs or ports.

## ADR-013 — Webhook baseline

Accepted. Webhook avoids mandatory email-provider setup. Email is added when practical.

## ADR-014 — Centralized SSRF control

Accepted. All outbound target validation and TLS connection setup live in the SSL service.

## ADR-015 — Validated/pinned DNS lookup

Accepted. Resolve, validate addresses, then connect using the validated address while preserving original hostname for SNI/verification.

## ADR-016 — Simple polling worker

Accepted. One worker with bounded polling/concurrency; queue infrastructure is deferred.

## ADR-017 — Minimum DB entities

Accepted:

- users
- domains
- ssl_checks
- alerts
- notification_settings
- mcp_api_keys

Deferred:

- ssl_certificates
- refresh_tokens/sessions
- organizations/teams
- billing
- notification_deliveries

## ADR-018 — One-day priority

Accepted. Cut SHOULD HAVE/post-MVP work first. Never cut authorization, SSRF protection, timeouts or critical tests.

## Implementation-level choices still open

- exact SQL/query/ORM library;
- exact scheduler interval;
- numeric rate limits;
- email provider;
- logging provider;
- final frontend host.

These do not change the product contracts.

## Phase 03 implementation decisions

- PostgreSQL access uses `pg` with explicit SQL repositories and versioned SQL migrations. No ORM is introduced for the MVP.
- Password hashing is Argon2id using the `argon2` package; JWTs use HMAC signing through `jsonwebtoken` with a short-lived configurable expiry.
- Network safety uses a single `packages/domain/src/ssl/networkSafety.ts` component. DNS answers are resolved once, all returned addresses are checked, and the validated address is used for TLS while the original hostname is retained for SNI/certificate hostname verification.
- TLS inspection uses `rejectUnauthorized: false` only at the socket-inspection layer so certificate metadata can still be collected for expired/untrusted certificates; `socket.authorized` plus explicit hostname/expiry checks determine application success. This does not mean invalid certificates are accepted as healthy.
- Phase 03 rate limits use in-process bounded counters as an MVP implementation parameter: general API 120/min/IP, login/registration 10/min/IP, domain creation 20/min/user+IP, manual checks 20/min/user+IP. A distributed limiter is deferred.
- Phase 03 performs DNS safety validation before domain persistence. A hostname that cannot be safely resolved is not persisted.
- The frontend, worker scheduler, notifications, MCP server, dashboard and billing remain deferred exactly as specified.

## ADR-019 — Conservative IP-range enforcement

Accepted during Phase 03 recovery. The centralized network-safety implementation uses numeric IPv4/IPv6 range checks rather than string-prefix matching. The deny policy explicitly covers private, loopback, link-local, CGNAT, documentation/test, multicast, reserved and IPv4-mapped destinations, and rejects mixed DNS answer sets when any returned address is unsafe. Regression coverage was added for these ranges.

## ADR-020 — Certificate endpoint uses latest successful snapshot

Accepted during Phase 03 recovery. `GET /domains/:domainId/certificate` returns certificate metadata from the latest successful SSL check, matching the Phase 02 API contract. Failed checks remain available through SSL status/history and do not overwrite the last usable certificate snapshot.
