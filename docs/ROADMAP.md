# SSL Monitor — Roadmap

## Phase 01 — Project Understanding

Status: COMPLETE.

Greenfield structure, architecture, dependencies, MVP/deferred boundary and security focus defined.

## Phase 02 — Product Specification

Status: COMPLETE.

PRD, architecture, minimum database model, REST API, MCP, security and testing contracts defined.

## Phase 03 — Core Implementation

Status: COMPLETE.

Verified areas:

- configuration and environment loading;
- PostgreSQL/Neon schema and migrations;
- authentication primitives;
- authenticated domain management;
- centralized SSRF/network safety;
- Node TLS SSL engine;
- certificate parsing/validation and expiry calculation;
- SSL check persistence and history;
- automated tests;
- API runtime and health verification;
- real SSL/TLS verification against a public hostname.

## Phase 04 — API

Status: COMPLETE.

Implemented and verified:

- REST authentication;
- domain CRUD;
- manual SSL checks;
- SSL status/certificate/history;
- alerts/settings;
- request validation;
- sanitized errors;
- API rate limiting;
- webhook SSRF validation;
- cross-user ownership enforcement.

## Phase 05 — Monitoring

Status: COMPLETE.

Verified:

- worker polling;
- due-domain detection;
- PostgreSQL row-lock claiming;
- bounded concurrency;
- scheduled checks;
- monitoring state transitions;
- stale-claim recovery;
- graceful shutdown;
- timeout/retry behavior;
- failure isolation.

## Phase 06 — Alerts

Status: COMPLETE.

Verified:

- certificate expiry alerts;
- TLS/SSL failure alerts;
- alert deduplication;
- alert state transitions;
- recovery handling;
- webhook delivery;
- optional SMTP email delivery;
- bounded notification retries;
- delivery-state persistence;
- alert/settings API integration.

## Phase 07 — Dashboard

Status: COMPLETE.

Implemented and verified:

- authenticated dashboard shell;
- Overview;
- Domains;
- Domain Details;
- Add/Delete Domain;
- manual Check Now;
- monitoring ON/OFF persistence;
- Alerts filtering and detail drawer;
- Notification Settings;
- authentication/protected-route handling;
- loading/empty/error/retry states;
- dark/light theme persistence;
- responsive desktop/mobile behavior;
- interactive 3D Earth;
- UTC day/night lighting;
- reduced-motion support;
- WebGL fallback;
- REST API integration using existing backend contracts.

Verification:

- `npm run format:check` → PASS;
- `npm run typecheck` → PASS;
- `npm run lint` → PASS;
- `npm test` → PASS;
- `npm run build` → PASS.

## Phase 08 — MCP

Status: IN PROGRESS — Parts 1–9 COMPLETE, Part 10 IN PROGRESS.

### Part 1 — Architecture Audit & MCP Foundation

Status: COMPLETE.

Existing architecture and dependency direction reviewed. Dedicated `apps/mcp` boundary confirmed. MCP integration is constrained to shared domain/application services without duplicating SSL, monitoring or alert business logic.

### Part 2 — Official MCP SDK & Dependencies

Status: COMPLETE.

Official MCP TypeScript SDK dependencies installed and runtime imports verified.

### Part 3 — Dedicated MCP Server

Status: COMPLETE.

Dedicated MCP HTTP server implemented at `/mcp` with initialization, transport handling and graceful shutdown.

### Part 4 — MCP API Key Authentication & Security

Status: COMPLETE.

Implemented:

- cryptographically random MCP API keys;
- hashed key persistence;
- bearer authentication;
- expiration;
- revocation;
- `last_used_at`;
- per-user ownership;
- key generation/revocation scripts.

### Part 5 — Nine MCP Tools

Status: COMPLETE.

Implemented:

1. `add_domain`
2. `remove_domain`
3. `get_domains`
4. `get_ssl_status`
5. `get_certificate_details`
6. `check_domain_now`
7. `list_expiring_certificates`
8. `list_ssl_errors`
9. `get_monitoring_history`

### Part 6 — Shared Service Integration

Status: COMPLETE.

MCP handlers use the existing domain/application services. SSL, monitoring, alert and network-safety logic is not duplicated inside MCP.

### Part 7 — Database & Persistence

Status: COMPLETE.

Existing `mcp_api_keys` persistence was reused. No duplicate MCP API-key migration was introduced.

### Part 8 — Security Hardening

Status: COMPLETE.

Implemented and verified:

- configurable MCP-specific rate limiting;
- safe authentication failures;
- sanitized tool errors;
- existing SSRF/network safety reuse;
- invalid-input handling;
- safe private/local target rejection.

### Part 9 — Tests & End-to-End Verification

Status: COMPLETE.

Verified:

- MCP tests;
- full test suite;
- TypeScript typecheck;
- ESLint;
- Prettier;
- production build;
- MCP server startup;
- unauthenticated rejection;
- authenticated initialization;
- MCP tool discovery;
- authenticated tool execution;
- security and rate-limit behavior.

Manual MCP verification completed successfully:

- unauthenticated `/mcp` → HTTP 401;
- authenticated `initialize` → HTTP 200;
- `tools/list` → HTTP 200;
- all 9 required tools exposed;
- authenticated `get_domains` → HTTP 200.

### Part 10 — Documentation & Production Readiness

Status: IN PROGRESS.

Remaining work:

- finalize MCP documentation;
- document API-key lifecycle;
- document all 9 tools;
- document MCP transport and endpoint behavior;
- document security and rate limiting;
- document development and verification commands;
- update architecture/security/testing references where required;
- complete final Phase 08 closeout.

## Phase 09 — Security + Testing

Status: PLANNED.

Execute the complete security regression and cross-interface verification gate after MCP integration.

## Phase 10 — Production

Status: PLANNED.

Production build/deployment, Neon, API, worker, web, MCP, health/logs, environment configuration, real-domain smoke test, E2E verification and launch documentation.

## Post-MVP

Planned/deferred areas:

- AI;
- billing;
- advanced analytics/reporting;
- teams/organizations;
- white-labeling;
- large integration catalog;
- browser automation;
- full website monitoring;
- multi-region monitoring;
- enterprise controls;
- incident management;
- DNS/domain-registration monitoring;
- arbitrary ports;
- public status pages.
