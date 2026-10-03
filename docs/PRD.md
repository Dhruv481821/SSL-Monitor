# SSL Monitor MCP — Product Requirements

## Product

SSL Monitor MCP is a focused operational monitoring product for tracking TLS/SSL certificate health across a user's domains.

## Problem

Teams managing multiple domains can miss certificate expiry or TLS failures until HTTPS availability is affected. The MVP provides domain registration, certificate inspection, scheduled checks, alerts, dashboard visibility, and MCP access.

## Target customer

- Web agencies/freelancers managing client domains
- MSPs
- Small SaaS teams managing a domain portfolio

## Primary user

An authenticated technical/operator user responsible for one or more HTTPS domains.

## Core workflow

```text
Register/Login
  → Add domain
  → Safe hostname validation
  → TLS inspection
  → Persist result
  → Dashboard status
  → Scheduled checks
  → Expiry/error evaluation
  → Alert/notification
  → MCP access to the same data
```

## Product goals

1. Detect certificate expiry early.
2. Surface TLS/certificate failures simply.
3. Maintain useful check history.
4. Automate recurring checks.
5. Expose the same authorized capabilities through MCP.
6. Keep the product small enough for the one-working-day MVP.
7. Establish reusable patterns without building a generic platform.

# MVP BOUNDARY

## MUST HAVE

- Registration/login and authorization
- Add/remove/list domains
- Hostname normalization and validation
- Node.js TLS certificate inspection
- Certificate validity, valid-from, expiry, days remaining
- Issuer, subject, DNS names where available
- TLS version
- Certificate/hostname validation
- Chain status/information where practical
- Normalized TLS/SSL error classification
- Persistent check history
- Monitoring state and scheduled checks
- Expiry/error alert rules
- At least one notification channel; webhook is the baseline, email when practical
- Basic dashboard
- MCP server and core tools
- SSRF/network-abuse protection
- Rate limiting
- Critical automated tests
- Production build/deployment
- Health endpoint and operational logs

## SHOULD HAVE

- Email notification if provider setup fits the deadline
- Alert deduplication/state transitions
- Simple webhook failure recording
- Useful monitoring-history UI

If SHOULD HAVE work threatens security, tests, or production correctness, defer it.

## POST-MVP

- AI
- Full website/uptime monitoring
- SEO
- Browser automation
- Billing/subscriptions
- Complex organizations/teams
- White-labeling
- Advanced analytics/reporting
- Large integration catalog
- Multi-region monitoring
- Enterprise policy systems
- Complex incident management
- DNS/domain-registration monitoring
- Arbitrary TCP ports
- Custom per-domain schedules
- Public status pages

## Functional requirements

### FR-01 Authentication

Users can register/login. Passwords use modern password hashing. Protected resources require authenticated identity.

### FR-02 Ownership

Every domain belongs to exactly one user in the MVP. Users can only access their own domains, checks, alerts and settings.

### FR-03 Domain input

Accept a hostname, not an arbitrary URL. Normalize it and reject schemes, paths, credentials, fragments and explicit ports.

### FR-04 TLS inspection

Manual and scheduled checks establish a bounded TLS connection and extract certificate/TLS metadata.

### FR-05 Certificate result

Successful results include validity dates, days remaining, issuer, subject, DNS names where available, TLS version, and validation/chain status.

### FR-06 Error result

Failed checks are persisted with stable error categories and sanitized messages.

### FR-07 History

Each completed attempt creates a check-history record.

### FR-08 Monitoring

Enabled domains have a next-check time. The worker invokes the same check service used by manual checks.

### FR-09 Alerts

Expiry thresholds and SSL/TLS failures create persisted alert state. Duplicate notifications for an ongoing condition are suppressed.

### FR-10 Notifications

Webhook and/or configured email can deliver alerts. Notification failure must not destroy the SSL result.

### FR-11 Dashboard

Provide domain list, current status, expiry/days remaining, last check, errors, certificate details, recent history, and notification settings.

### FR-12 MCP

Authorized MCP clients can query/operate on only the authenticated user's resources using the shared business services.

## Non-functional requirements

- TypeScript application code
- React + Vite + Tailwind
- Fastify API
- PostgreSQL/Neon
- Node TLS APIs
- Zod runtime validation
- Shared business services for API, dashboard, worker and MCP
- Bounded TLS/DNS timeouts
- SSRF/network-abuse protection
- Authorization on every protected resource
- Secrets excluded from source control/logs/responses
- Automated critical-path tests
- Production health verification
- Simple enough for a one-working-day MVP

## Success criteria

An authenticated user can register, add a real HTTPS hostname, inspect certificate health, see expiry/issuer/subject/TLS data, retain history, receive scheduled expiry/error alerts, view the result in the dashboard, and query the same data through authorized MCP. Unsafe targets and cross-user access are rejected, and critical tests pass.

## One-day rule

If time is lost, cut SHOULD HAVE and POST-MVP work first. Never cut authentication/authorization, SSRF protection, timeouts, or critical tests.
