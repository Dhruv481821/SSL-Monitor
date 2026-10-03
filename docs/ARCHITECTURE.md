# SSL Monitor MCP — Production Architecture

## Principles

1. One shared business/domain implementation.
2. Interfaces are thin adapters.
3. SSL/network safety is centralized.
4. Persistence is isolated behind repositories.
5. Worker and request paths use the same SSL/check services.
6. Runtime topology stays small.
7. No premature queue infrastructure.
8. The dashboard is a presentation layer; backend contracts remain authoritative.

## Target repository

```text
ssl-monitor/
├── apps/
│   ├── api/src/
│   ├── web/src/
│   ├── worker/src/{worker.ts}
│   └── mcp/src/
├── packages/
│   ├── domain/src/{auth/,domains/,ssl/,checks/,alerts/,notifications/,monitoring/}
│   ├── db/src/{client.ts,repositories/,migrations/}
│   ├── config/src/
│   └── shared/src/{types/,errors/,validation/}
├── tests/{unit/,integration/,api/,mcp/,security/}
├── docs/
└── package.json
```

## Boundaries

### Web

React + TypeScript + Vite + Tailwind. Renders application state and calls the authenticated REST API. It never performs authoritative TLS inspection.

The Phase 07 web surface owns presentation concerns including routing/auth UI state, theme state, responsive layout, loading/error/empty states and dashboard visualization. API responses remain authoritative for domain, monitoring, alert and notification-settings state.

### API

Node.js + TypeScript + Fastify. Handles HTTP, authentication, authorization, validation, rate limiting, service invocation, and response/error serialization. No certificate parsing.

### Domain/business

`packages/domain`. Owns domain lifecycle, normalization, SSL orchestration, certificate normalization, monitoring state transitions, alert evaluation and notification business rules. It must not depend on React, Fastify, or the MCP SDK.

### SSL engine

`packages/domain/src/ssl/`. The authoritative implementation for DNS safety, TLS connection, certificate extraction, hostname verification, chain status, TLS metadata, timeouts and normalized failures.

### Database

`packages/db`. PostgreSQL/Neon connection, migrations and transaction support. Database details do not leak into interface handlers.

### Worker

`apps/worker`. Independently executable background process. It claims due domains using PostgreSQL row-level locking, processes claims with bounded concurrency, invokes the shared monitoring/check service, persists results, schedules the next run, and recovers stale claims. It does not contain independent TLS/DNS/SSRF logic.

### Monitoring service

`packages/domain/src/monitoring/`. Orchestrates scheduled SSL checks using the existing SSL engine and check persistence abstractions. It owns retry/backoff and next-check scheduling decisions.

### Alerts and notifications

`packages/domain/src/alerts/` evaluates normalized SSL results into persisted alert state. `packages/domain/src/notifications/` owns user settings and channel delivery. Monitoring persists the SSL result and domain state first, then evaluates alerts and dispatches notifications; notification failure cannot roll back the monitoring transaction. Webhooks reuse the centralized network-safety resolver and validated-address connection path. Email uses the provider abstraction with optional SMTP configuration.

### MCP

`apps/mcp`. Dedicated MCP adapter using the official TypeScript MCP SDK.

Responsibilities:

- MCP HTTP transport;
- MCP initialization and tool discovery;
- API-key authentication;
- API-key expiration and revocation handling;
- authenticated user context;
- MCP-specific rate limiting;
- tool input validation;
- stable structured tool results;
- sanitized MCP errors;
- invocation of shared domain/application services.

The MCP layer does not implement independent SSL, DNS, SSRF, monitoring, alert or notification business logic.

The nine Phase 08 tools are:

- `add_domain`
- `remove_domain`
- `get_domains`
- `get_ssl_status`
- `get_certificate_details`
- `check_domain_now`
- `list_expiring_certificates`
- `list_ssl_errors`
- `get_monitoring_history`

Authentication derives the user identity from the MCP API key. Tool handlers do not accept a caller-supplied user ID.

MCP reuses the existing ownership model and centralized network-safety controls.

## Dependency direction

```text
Web ───────┐
API ───────┤
MCP ───────┼──> Shared Domain/Application Services ──> Repositories
Worker ────┘                  │
                             └──> SSL Engine
```

The worker and API use the same SSL engine and monitoring/check services. The dashboard does not duplicate any authoritative SSL or monitoring logic.

## Phase 07 dashboard flow

```text
Browser
  → authenticated REST API
  → shared domain/application services
  → repositories / SSL / monitoring / alerts / notifications
  → JSON response
  → React dashboard state
  → presentation / visualization
```

The Earth visualization is decorative. The current domain model does not provide verified latitude/longitude, so the dashboard does not invent geographic domain markers.

## Earth visualization architecture

The Earth implementation is separated into reusable modules under `apps/web/src/components/earth/`, including scene setup, lighting, atmosphere, orbit, markers, solar position and the `EarthGlobe` component.

Required runtime behavior:

- real geographic texture;
- UTC-based day/night illumination;
- animation with a controlled time scale;
- reduced-motion support;
- WebGL fallback;
- resource disposal on unmount;
- no fabricated domain coordinates.

## Authentication behavior

The web app keeps authentication state in React state and local storage. Protected data requests are only made after authentication is established. A 401 clears the session and returns the application to login. Direct access to protected routes while logged out remains blocked.

## Responsive behavior

The dashboard uses responsive navigation and content layouts. The sidebar collapses on small screens, dashboard cards adapt to available width, and the Earth visualization scales without requiring horizontal scrolling.

## Alert/notification flow

```text
SSL check result
  -> alert evaluation
  -> fingerprint/deduplication
  -> persisted alert
  -> per-channel delivery state
  -> webhook/email provider
  -> delivered / bounded retry / terminal failure
  -> recovery resolves prior open condition
```

Notification delivery is downstream of monitoring persistence and is failure-isolated.

## Asynchronous monitoring flow

```text
Worker poll
  → recover stale claims
  → atomically claim due domains (FOR UPDATE SKIP LOCKED)
  → bounded-concurrency scheduled checks
  → shared SSL engine
  → transactional check persistence + domain state transition
  → retry or normal next-check scheduling
  → release claim
```

## Configuration

Centralized startup validation covers environment, database URL, JWT secret, API limits, CORS and worker timing/concurrency values. Secrets remain in environment/deployment secret storage.

## Deployment target

Web: Vercel/equivalent. API + worker: Railway. Database: Neon. MCP: production Node runtime, preferably co-located with API infrastructure where transport/security permits. Production deployment is outside Phase 07.
