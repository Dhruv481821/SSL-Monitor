# SSL Monitor MCP — Testing Strategy

## Layers

### Unit

Test hostname normalization, expiry/day calculation, SSL classification, alert thresholds/deduplication, authorization decisions, schemas, IP/network safety and monitoring scheduling rules.

### SSL/TLS integration

Use controlled TLS test servers/certificates for valid, expired, near-expiry, hostname mismatch, invalid/untrusted, TLS failure, metadata extraction, chain status, DNS failure, connection refusal and timeout scenarios.

### Database integration

Verify user creation/uniqueness, domain ownership/uniqueness, check history, monitoring state, alert lifecycle, notification settings ownership, MCP key hashing/lookup and FK behavior.

### API

Test registration/login, invalid credentials, domain CRUD, ownership, manual check, status/certificate/history, alerts/settings, malformed requests, rate limits and sanitized errors.

### Web dashboard — Phase 07

Verify:

- login/register rendering;
- authenticated/protected routes;
- invalid/expired authentication handling;
- domain listing/creation/deletion;
- monitoring ON/OFF persistence;
- manual Check Now;
- alerts rendering and filtering;
- alert detail drawer;
- notification-settings update;
- independent loading/empty/error/retry states;
- dark/light theme switching and persistence;
- responsive desktop/mobile behavior;
- 3D Earth rendering and animation;
- UTC day/night behavior;
- reduced-motion behavior;
- WebGL fallback;
- no duplicate Earth canvas or unhandled rendering errors.

### MCP

For every selected tool test valid input, invalid input, authentication, authorization, output schema, shared-service behavior, safe errors and rate limiting. Phase 08 implementation is next.

## Security

Test localhost/private/reserved addresses, IPv6 and IPv4-mapped cases, mixed public/private DNS answers, DNS rebinding, malformed hostnames, URL/port injection, cross-user resource access, revoked MCP keys, rate limits and secret/error leakage.

## Phase 07 quality gate

Required automated gates:

1. `npm install`
2. `npm run format:check`
3. `npm run typecheck`
4. `npm run lint`
5. `npm test`
6. `npm run build`

### Verified results

- `npm install` → PASS
- `npm run format:check` → PASS
- `npm run typecheck` → PASS
- `npm run lint` → PASS
- `npm test` → PASS — **11 test files, 54/54 tests, 0 failures**
- `npm run build` → PASS

The Vite build reports a non-blocking warning that the main JavaScript chunk is larger than 500 kB after minification. This does not invalidate the build or Phase 07 gate.

## Phase 07 manual verification

Verified during implementation:

| Scenario                                | Result                  |
| --------------------------------------- | ----------------------- |
| Login/register                          | PASS                    |
| Protected direct route while logged out | PASS                    |
| Invalid/expired token                   | PASS — returns to login |
| Dashboard                               | PASS                    |
| Add/Delete Domain                       | PASS                    |
| Check Now                               | PASS                    |
| Monitoring ON/OFF + refresh persistence | PASS                    |
| Alerts filters                          | PASS                    |
| Alert detail drawer                     | PASS                    |
| Notification settings                   | PASS                    |
| API unavailable error state             | PASS                    |
| Retry/recovery                          | PASS                    |
| Empty states                            | PASS                    |
| Dark mode                               | PASS                    |
| Light mode                              | PASS                    |
| Theme persistence                       | PASS                    |
| Desktop responsive                      | PASS                    |
| Mobile responsive                       | PASS                    |
| Real Earth texture                      | PASS                    |
| Earth rotation/orbit                    | PASS                    |
| Day/night behavior                      | PASS                    |
| Reduced motion                          | PASS                    |
| WebGL fallback                          | PASS                    |

## Test isolation note

The monitoring integration tests use a shared development PostgreSQL database when `DATABASE_URL` is present. Existing manually-created monitoring rows initially consumed the global claim batch and interfered with one selection assertion. Existing development monitoring rows were disabled for test isolation, after which the complete monitoring suite and full project suite passed.

The production `claimDueDomains()` implementation was not altered to make the test pass. This should be replaced by a dedicated isolated test database/cleanup strategy before CI is formalized.

## Completion rule

Phase 07 is complete because all required automated gates passed and the required browser/manual verification scenarios were completed. Phase 08 MCP is the next implementation phase.
