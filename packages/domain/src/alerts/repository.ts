import {
  query,
  withTransaction,
  type QueryExecutor,
} from "../../../db/src/client.js";

export interface AlertRow {
  id: string;
  user_id: string;
  domain_id: string;
  type: string;
  severity: string;
  state: string;
  fingerprint: string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  created_at: string;
}

export interface AlertDeliveryRow {
  id: string;
  alert_id: string;
  user_id: string;
  channel: "webhook" | "email";
  status: "pending" | "delivered" | "failed";
  attempt_count: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAlerts(
  userId: string,
  state: string | undefined,
  limit: number,
): Promise<AlertRow[]> {
  if (state) {
    return (
      await query<AlertRow>(
        "SELECT * FROM alerts WHERE user_id=$1 AND state=$2 ORDER BY created_at DESC LIMIT $3",
        [userId, state, limit],
      )
    ).rows;
  }

  return (
    await query<AlertRow>(
      "SELECT * FROM alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit],
    )
  ).rows;
}

export async function openAlertByFingerprint(
  userId: string,
  fingerprint: string,
): Promise<AlertRow | null> {
  return (
    (
      await query<AlertRow>(
        `SELECT * FROM alerts WHERE user_id=$1 AND fingerprint=$2 AND state='open' LIMIT 1`,
        [userId, fingerprint],
      )
    ).rows[0] ?? null
  );
}

export async function upsertOpenAlert(input: {
  userId: string;
  domainId: string;
  type: string;
  severity: string;
  fingerprint: string;
  message: string;
  now?: Date;
}): Promise<{ alert: AlertRow; created: boolean }> {
  const now = (input.now ?? new Date()).toISOString();
  const result = await query<AlertRow & { inserted: boolean }>(
    `INSERT INTO alerts
      (user_id,domain_id,type,severity,state,fingerprint,message,first_seen_at,last_seen_at,resolved_at,created_at)
     VALUES($1,$2,$3,$4,'open',$5,$6,$7,$7,NULL,$7)
     ON CONFLICT (user_id,fingerprint) WHERE state='open'
     DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at, message=EXCLUDED.message
     RETURNING alerts.*, (xmax = 0) AS inserted`,
    [
      input.userId,
      input.domainId,
      input.type,
      input.severity,
      input.fingerprint,
      input.message,
      now,
    ],
  );
  const row = result.rows[0];
  return { alert: row, created: row.inserted };
}

export async function resolveOpenAlerts(
  userId: string,
  domainId: string,
  types: string[],
  now = new Date(),
): Promise<AlertRow[]> {
  if (types.length === 0) return [];
  return (
    await query<AlertRow>(
      `UPDATE alerts
       SET state='resolved', resolved_at=$4, last_seen_at=$4
       WHERE user_id=$1 AND domain_id=$2 AND state='open' AND type = ANY($3::text[])
       RETURNING *`,
      [userId, domainId, types, now.toISOString()],
    )
  ).rows;
}

export async function createRecoveryAlert(input: {
  userId: string;
  domainId: string;
  message: string;
  now?: Date;
}): Promise<AlertRow> {
  const now = (input.now ?? new Date()).toISOString();
  return (
    await query<AlertRow>(
      `INSERT INTO alerts
        (user_id,domain_id,type,severity,state,fingerprint,message,first_seen_at,last_seen_at,resolved_at,created_at)
       VALUES($1,$2,'domain_recovered','info','resolved',$3,$4,$5,$5,$5,$5)
       RETURNING *`,
      [
        input.userId,
        input.domainId,
        `domain_recovered:${input.domainId}:${now}`,
        input.message,
        now,
      ],
    )
  ).rows[0];
}

export async function createDelivery(
  alertId: string,
  userId: string,
  channel: "webhook" | "email",
): Promise<AlertDeliveryRow> {
  return (
    await query<AlertDeliveryRow>(
      `INSERT INTO alert_deliveries(alert_id,user_id,channel,status)
       VALUES($1,$2,$3,'pending')
       ON CONFLICT(alert_id,channel) DO UPDATE SET updated_at=now()
       RETURNING *`,
      [alertId, userId, channel],
    )
  ).rows[0];
}

export async function markDeliveryAttempt(
  deliveryId: string,
  status: AlertDeliveryRow["status"],
  attemptCount: number,
  nextAttemptAt: Date | null,
  errorMessage: string | null,
  deliveredAt: Date | null,
): Promise<AlertDeliveryRow> {
  return (
    await query<AlertDeliveryRow>(
      `UPDATE alert_deliveries
       SET status=$2, attempt_count=$3, next_attempt_at=$4, last_attempt_at=now(),
           delivered_at=$5, last_error=$6, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        deliveryId,
        status,
        attemptCount,
        nextAttemptAt?.toISOString() ?? null,
        deliveredAt?.toISOString() ?? null,
        errorMessage,
      ],
    )
  ).rows[0];
}

export async function listDeliveriesForAlerts(
  alertIds: string[],
): Promise<AlertDeliveryRow[]> {
  if (alertIds.length === 0) return [];
  return (
    await query<AlertDeliveryRow>(
      "SELECT * FROM alert_deliveries WHERE alert_id = ANY($1::uuid[]) ORDER BY created_at ASC",
      [alertIds],
    )
  ).rows;
}
