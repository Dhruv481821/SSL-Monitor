import {
  query,
  withTransaction,
  type QueryExecutor,
} from "../../../db/src/client.js";

export interface DomainRow {
  id: string;
  user_id: string;
  hostname: string;
  status: string;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  monitoring_claimed_at: string | null;
  monitoring_claim_token: string | null;
  monitoring_retry_count: number;
  created_at: string;
  updated_at: string;
}

export async function createDomain(userId: string, hostname: string) {
  return (
    await query<DomainRow>(
      "INSERT INTO domains(user_id,hostname) VALUES($1,$2) RETURNING *",
      [userId, hostname],
    )
  ).rows[0];
}

export async function listDomains(userId: string) {
  return (
    await query<DomainRow>(
      "SELECT * FROM domains WHERE user_id=$1 ORDER BY created_at DESC",
      [userId],
    )
  ).rows;
}

export async function getDomain(userId: string, id: string) {
  return (
    (
      await query<DomainRow>(
        "SELECT * FROM domains WHERE id=$1 AND user_id=$2",
        [id, userId],
      )
    ).rows[0] ?? null
  );
}

export async function deleteDomain(userId: string, id: string) {
  const r = await query("DELETE FROM domains WHERE id=$1 AND user_id=$2", [
    id,
    userId,
  ]);
  return r.rowCount === 1;
}

export async function setMonitoring(
  userId: string,
  id: string,
  enabled: boolean,
) {
  const result = await query<DomainRow>(
    `UPDATE domains
     SET monitoring_enabled=$3,
         next_check_at=CASE WHEN $3 THEN now() ELSE NULL END,
         monitoring_claimed_at=NULL,
         monitoring_claim_token=NULL,
         monitoring_retry_count=0,
         updated_at=now()
     WHERE id=$1 AND user_id=$2
     RETURNING *`,
    [id, userId, enabled],
  );
  return result.rows[0] ?? null;
}

export async function updateAfterCheck(
  domainId: string,
  success: boolean,
  status: string,
) {
  await query(
    `UPDATE domains SET status=$2,last_checked_at=now(),last_success_at=CASE WHEN $3 THEN now() ELSE last_success_at END,
     consecutive_failures=CASE WHEN $3 THEN 0 ELSE consecutive_failures+1 END,updated_at=now() WHERE id=$1`,
    [domainId, status, success],
  );
}

export async function claimDueDomains(
  batchSize: number,
  staleClaimTimeoutMs: number,
): Promise<{ domains: DomainRow[]; recoveredStale: number }> {
  return withTransaction(async (client) => {
    const stale = await client.query<{ id: string }>(
      `UPDATE domains
       SET monitoring_claimed_at=NULL,
           monitoring_claim_token=NULL,
           updated_at=now()
       WHERE monitoring_claimed_at IS NOT NULL
         AND monitoring_claimed_at < now() - ($1::bigint * interval '1 millisecond')
       RETURNING id`,
      [staleClaimTimeoutMs],
    );

    const recoveredIds = stale.rows.map((row) => row.id);

    const result = await client.query<DomainRow>(
      `WITH recovered_due AS (
         SELECT id
         FROM domains
         WHERE monitoring_enabled=true
           AND (next_check_at IS NULL OR next_check_at <= now())
           AND monitoring_claimed_at IS NULL
           AND id = ANY($2::uuid[])
         ORDER BY
           COALESCE(next_check_at, created_at),
           created_at,
           id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       ),
       remaining_due AS (
         SELECT id
         FROM domains
         WHERE monitoring_enabled=true
           AND (next_check_at IS NULL OR next_check_at <= now())
           AND monitoring_claimed_at IS NULL
           AND NOT (id = ANY($2::uuid[]))
         ORDER BY
           COALESCE(next_check_at, created_at),
           created_at,
           id
         FOR UPDATE SKIP LOCKED
         LIMIT GREATEST($1 - (SELECT count(*) FROM recovered_due), 0)
       ),
       due AS (
         SELECT id FROM recovered_due
         UNION ALL
         SELECT id FROM remaining_due
       )
       UPDATE domains d
       SET monitoring_claimed_at=now(),
           monitoring_claim_token=gen_random_uuid(),
           updated_at=now()
       FROM due
       WHERE d.id=due.id
       RETURNING d.*`,
      [batchSize, recoveredIds],
    );

    return {
      domains: result.rows,
      recoveredStale: stale.rowCount ?? 0,
    };
  });
}

export async function finalizeMonitoringCheck(
  client: QueryExecutor,
  domainId: string,
  claimToken: string,
  success: boolean,
  status: string,
  nextCheckAt: Date,
  retryCount: number,
) {
  const result = await client.query<DomainRow>(
    `UPDATE domains
     SET status=$3,
         last_checked_at=now(),
         last_success_at=CASE WHEN $4 THEN now() ELSE last_success_at END,
         consecutive_failures=CASE WHEN $4 THEN 0 ELSE consecutive_failures+1 END,
         next_check_at=$5,
         monitoring_retry_count=$6,
         monitoring_claimed_at=NULL,
         monitoring_claim_token=NULL,
         updated_at=now()
     WHERE id=$1 AND monitoring_claim_token=$2
     RETURNING *`,
    [
      domainId,
      claimToken,
      status,
      success,
      nextCheckAt.toISOString(),
      retryCount,
    ],
  );

  if (result.rowCount !== 1)
    throw new Error("Monitoring claim was lost before check finalization");

  return result.rows[0];
}

export async function releaseMonitoringClaim(
  domainId: string,
  claimToken: string,
) {
  await query(
    `UPDATE domains
     SET monitoring_claimed_at=NULL, monitoring_claim_token=NULL, updated_at=now()
     WHERE id=$1 AND monitoring_claim_token=$2`,
    [domainId, claimToken],
  );
}
