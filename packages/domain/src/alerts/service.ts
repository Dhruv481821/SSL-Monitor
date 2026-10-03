import type { SslCheckResult } from "../../../shared/src/index.js";
import * as repo from "./repository.js";

export type AlertType =
  | "certificate_expiring"
  | "certificate_expired"
  | "invalid_certificate"
  | "ssl_check_failure"
  | "domain_unhealthy"
  | "domain_recovered";

export interface AlertView {
  id: string;
  domainId: string;
  type: string;
  severity: string;
  state: string;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  createdAt: string;
  deliveries: Array<{
    channel: string;
    status: string;
    attemptCount: number;
    nextAttemptAt: string | null;
    deliveredAt: string | null;
  }>;
}

export interface AlertEvaluationInput {
  userId: string;
  domainId: string;
  hostname: string;
  result: SslCheckResult;
  expiryThresholdDays: number[];
  consecutiveFailures: number;
}

export interface AlertEvent {
  alert: repo.AlertRow;
  created: boolean;
}

const INVALID_CERTIFICATE_CODES = new Set([
  "CERTIFICATE_ERROR",
  "HOSTNAME_MISMATCH",
]);

function alertLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "ssl-monitor-alerts",
      event,
      ...fields,
    }),
  );
}

function severityForExpiry(days: number): "warning" | "critical" {
  return days <= 7 ? "critical" : "warning";
}

export function evaluateAlertEvents(input: AlertEvaluationInput): Array<{
  type: AlertType;
  severity: "info" | "warning" | "critical";
  fingerprint: string;
  message: string;
}> {
  const { result, expiryThresholdDays } = input;
  const events: Array<{
    type: AlertType;
    severity: "info" | "warning" | "critical";
    fingerprint: string;
    message: string;
  }> = [];
  const thresholds = [...new Set(expiryThresholdDays)].sort((a, b) => b - a);

  if (result.success && result.daysRemaining !== null) {
    for (const threshold of thresholds) {
      if (result.daysRemaining <= threshold && result.daysRemaining >= 0) {
        events.push({
          type: "certificate_expiring",
          severity: severityForExpiry(result.daysRemaining),
          fingerprint: `certificate_expiring:${input.domainId}:${threshold}`,
          message: `${input.hostname} certificate expires in ${result.daysRemaining} day(s) (threshold ${threshold} days)`,
        });
      }
    }
  }

  if (result.status === "expired" || result.errorCode === "CERT_EXPIRED") {
    events.push({
      type: "certificate_expired",
      severity: "critical",
      fingerprint: `certificate_expired:${input.domainId}`,
      message: `${input.hostname} certificate is expired`,
    });
  } else if (
    !result.success &&
    result.errorCode &&
    INVALID_CERTIFICATE_CODES.has(result.errorCode)
  ) {
    events.push({
      type: "invalid_certificate",
      severity: "critical",
      fingerprint: `invalid_certificate:${input.domainId}:${result.errorCode}`,
      message: `${input.hostname} certificate validation failed (${result.errorCode})`,
    });
  } else if (!result.success) {
    events.push({
      type: "ssl_check_failure",
      severity: "critical",
      fingerprint: `ssl_check_failure:${input.domainId}:${result.errorCode ?? "TLS_ERROR"}`,
      message: `${input.hostname} SSL/TLS check failed (${result.errorCode ?? "TLS_ERROR"})`,
    });
  }

  if (!result.success) {
    events.push({
      type: "domain_unhealthy",
      severity: "critical",
      fingerprint: `domain_unhealthy:${input.domainId}`,
      message: `${input.hostname} is unhealthy: SSL/TLS monitoring check failed`,
    });
  }

  return events;
}

export async function evaluateAndPersist(
  input: AlertEvaluationInput,
): Promise<AlertEvent[]> {
  const events = evaluateAlertEvents(input);
  const created: AlertEvent[] = [];
  for (const event of events) {
    const result = await repo.upsertOpenAlert({
      userId: input.userId,
      domainId: input.domainId,
      type: event.type,
      severity: event.severity,
      fingerprint: event.fingerprint,
      message: event.message,
    });
    if (result.created) {
      created.push(result);
      alertLog("alert_created", {
        alertId: result.alert.id,
        domainId: input.domainId,
        type: event.type,
      });
    } else {
      alertLog("alert_duplicate_suppressed", {
        domainId: input.domainId,
        type: event.type,
      });
    }
  }

  if (input.result.success && input.result.status !== "expired") {
    const resolvedTypes = [
      "certificate_expired",
      "invalid_certificate",
      "ssl_check_failure",
      "domain_unhealthy",
    ];
    if (
      input.result.daysRemaining === null ||
      input.result.daysRemaining > Math.max(...input.expiryThresholdDays)
    ) {
      resolvedTypes.push("certificate_expiring");
    }
    const resolved = await repo.resolveOpenAlerts(
      input.userId,
      input.domainId,
      resolvedTypes,
    );
    if (resolved.length > 0) {
      alertLog("alert_resolved", {
        domainId: input.domainId,
        count: resolved.length,
      });
      const recovery = await repo.createRecoveryAlert({
        userId: input.userId,
        domainId: input.domainId,
        message: `${input.hostname} SSL/TLS health has recovered`,
      });
      created.push({ alert: recovery, created: true });
      alertLog("alert_recovery_created", {
        alertId: recovery.id,
        domainId: input.domainId,
      });
    }
  }

  return created;
}

export async function list(
  userId: string,
  state: string | undefined,
  limit: number,
): Promise<AlertView[]> {
  const rows = await repo.listAlerts(userId, state, limit);
  const deliveries = await repo.listDeliveriesForAlerts(
    rows.map((row) => row.id),
  );
  const deliveriesByAlert = new Map<string, repo.AlertDeliveryRow[]>();
  for (const delivery of deliveries) {
    const existing = deliveriesByAlert.get(delivery.alert_id) ?? [];
    existing.push(delivery);
    deliveriesByAlert.set(delivery.alert_id, existing);
  }
  return rows.map((row) => ({
    id: row.id,
    domainId: row.domain_id,
    type: row.type,
    severity: row.severity,
    state: row.state,
    message: row.message,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    deliveries: (deliveriesByAlert.get(row.id) ?? []).map((delivery) => ({
      channel: delivery.channel,
      status: delivery.status,
      attemptCount: delivery.attempt_count,
      nextAttemptAt: delivery.next_attempt_at,
      deliveredAt: delivery.delivered_at,
    })),
  }));
}

export async function evaluatePersistAndNotify(
  input: AlertEvaluationInput,
  settings: {
    emailEnabled: boolean;
    emailAddress: string | null;
    webhookEnabled: boolean;
    webhookUrl: string | null;
  },
  dispatch: (
    alert: repo.AlertRow,
    settings: {
      emailEnabled: boolean;
      emailAddress: string | null;
      webhookEnabled: boolean;
      webhookUrl: string | null;
    },
  ) => Promise<void>,
): Promise<void> {
  const events = await evaluateAndPersist(input);
  for (const event of events) {
    await dispatch(event.alert, settings);
  }
}
