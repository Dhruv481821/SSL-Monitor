# SSL Monitor MCP — Phase 06 Report

## Status

**PHASE 06 IMPLEMENTED — VERIFICATION PENDING**

Phase 06 adds the alerting and notification subsystem on top of the verified Phase 05 monitoring pipeline. The completion gate remains open until the full project verification suite, database migration, API checks and worker/alert delivery verification pass in the actual project environment.

## Implemented scope

- alert evaluation for configured certificate-expiry thresholds;
- certificate-expired alerts;
- invalid-certificate alerts;
- SSL/TLS check-failure alerts;
- domain-unhealthy alerts;
- domain-recovered events;
- fingerprint-based open-alert deduplication;
- alert state resolution on recovery;
- persisted per-channel notification delivery state;
- bounded notification retry with exponential backoff and terminal failure;
- webhook delivery using the existing centralized DNS/SSRF safety path and pinned validated address;
- optional SMTP email delivery through a provider abstraction;
- notification failure isolation from persisted SSL checks and monitoring state;
- structured notification lifecycle logs without credentials or webhook secrets;
- existing alert and notification-settings REST endpoints retained and extended with delivery status in alert responses;
- Phase 06 unit/integration coverage.

## Alert lifecycle

```text
Scheduled/manual SSL check
  -> persist SSL check + monitoring/domain state
  -> evaluate alert conditions
  -> deduplicate/update open alert state
  -> persist newly-created alert
  -> create per-channel delivery state
  -> bounded notification attempts
  -> delivered / pending-retry / failed
  -> resolve alert on recovery
  -> emit recovery event when an open condition resolves
```

Alert evaluation never performs a second SSL/TLS check. It consumes the normalized result produced by the shared SSL engine and monitoring service.

## Alert types

- `certificate_expiring`
- `certificate_expired`
- `invalid_certificate`
- `ssl_check_failure`
- `domain_unhealthy`
- `domain_recovered`

Expiry alerts use the configured `expiryThresholdDays` values from notification settings. An ongoing alert is fingerprinted by domain, type and expiry threshold so the same condition does not generate duplicate open alerts.

## Notification channels

### Webhook

- HTTPS only on port 443;
- URL validation reuses the existing hostname/DNS safety policy;
- every delivery resolves and validates the destination before connecting;
- the validated IP is used for the outbound TLS connection while the original hostname remains SNI;
- bounded request timeout;
- bounded retry count and exponential backoff;
- sanitized failure state/logging.

### Email

SMTP is implemented behind an `EmailProvider` abstraction. Configuration is environment-only (`SMTP_*`); credentials are never persisted or logged. If SMTP is not configured, an enabled email delivery records a terminal delivery failure rather than affecting monitoring state.

## Database

Migration `003_alert_deliveries.sql` adds `alert_deliveries` with:

- alert/user ownership;
- `webhook`/`email` channel;
- `pending`/`delivered`/`failed` state;
- attempt count;
- next retry time;
- last attempt/delivery timestamps;
- sanitized last error;
- unique `(alert_id, channel)` delivery identity;
- retry/user indexes.

Existing `alerts` and `notification_settings` tables remain authoritative. No certificate-history table was added.

## REST API

Existing Phase 04 endpoints remain the alert/settings surface:

- `GET /api/v1/alerts`
- `GET /api/v1/notification-settings`
- `PUT /api/v1/notification-settings`

`GET /api/v1/alerts` now includes channel delivery status for each returned alert. Authentication and user ownership filtering remain enforced.

## Tests added

- alert threshold evaluation;
- expired/invalid/TLS failure classification;
- no-event healthy result behavior;
- database alert deduplication;
- recovery resolution and recovery event creation;
- existing Phase 05 monitoring/API/security regression coverage remains unchanged.

## Verification gate

Required before declaring Phase 06 complete:

1. `npm install`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run format:check`
5. `npm test`
6. `npm run db:migrate`
7. API alert/settings verification
8. scheduled monitoring -> alert persistence verification
9. webhook delivery success/failure/retry verification
10. email provider isolation verification
11. recovery/dedup verification
12. security/ownership/SSRF regression verification
13. worker startup/shutdown verification

Until these are executed successfully in the actual repository environment, Phase 06 remains **VERIFICATION PENDING** and the roadmap must not advance to 60%.

## Explicit exclusions

Phase 06 does not implement:

- dashboard UI;
- MCP tools/API keys;
- billing/payments;
- AI features;
- production deployment;
- unrelated refactoring;
- new monitoring/TLS implementations.
