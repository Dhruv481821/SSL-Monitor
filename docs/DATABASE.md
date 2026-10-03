# SSL Monitor MCP — Database Design

## MVP tables

1. `users`
2. `domains`
3. `ssl_checks`
4. `alerts`
5. `notification_settings`
6. `mcp_api_keys`

## Phase 07 database impact

**No database migration was added in Phase 07.**

The existing Phase 03–06 schema remains authoritative. Dashboard operations use the existing REST API and repository/domain services rather than introducing frontend-specific persistence.

## Monitoring state

The `domains` table is the source of truth for scheduling state.

| Field                    | Purpose                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `monitoring_enabled`     | Enables/disables background monitoring.                                                                                     |
| `next_check_at`          | Due time for the next normal or retry check. Null means the domain has never been scheduled and is eligible for the worker. |
| `last_checked_at`        | Timestamp of the most recent completed check.                                                                               |
| `last_success_at`        | Timestamp of the most recent successful check.                                                                              |
| `consecutive_failures`   | Consecutive failed check count. Reset on success.                                                                           |
| `monitoring_claimed_at`  | Timestamp when a worker claimed the domain. Used for stale-claim recovery.                                                  |
| `monitoring_claim_token` | Per-claim PostgreSQL UUID used to prove ownership during finalization/release.                                              |
| `monitoring_retry_count` | Current retry sequence. Reset after success or retry exhaustion.                                                            |

## Due-domain selection

The worker considers a domain due when:

```sql
monitoring_enabled = true
AND (next_check_at IS NULL OR next_check_at <= now())
AND monitoring_claimed_at IS NULL
```

Claims older than the configured stale-claim timeout are recovered before selection. Claiming uses PostgreSQL row locks with `FOR UPDATE SKIP LOCKED` and a generated claim token in one transaction.

## Check persistence

`ssl_checks` remains the immutable snapshot/history table. Scheduled checks persist the normalized SSL result and update domain state transactionally.

## Retry state

Retry scheduling is stored in `next_check_at`. `monitoring_retry_count` tracks the retry sequence. Backoff is exponential from the configured base delay and is capped at the normal monitoring interval. After retry exhaustion, the next run uses the normal interval and retry count resets.

## Phase 06 alert delivery

`alerts` remains the alert identity/state table. Active alerts are deduplicated by the existing fingerprint model. Migration `003_alert_deliveries.sql` adds `alert_deliveries` for channel-specific delivery state.

## Phase 07 persistence boundary

The dashboard does not write directly to PostgreSQL. All state changes continue through authenticated REST endpoints and the existing domain/application layer.

Dashboard actions mapped to existing persistence paths include:

- create/delete domain;
- enable/disable monitoring;
- manual SSL check;
- notification-settings update.

Alert filtering and details are read from the existing alert API and do not create a second alert store.
