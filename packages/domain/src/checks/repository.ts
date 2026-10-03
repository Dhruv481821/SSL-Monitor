import { query, type QueryExecutor } from "../../../db/src/client.js";
import type { SslCheckResult } from "../../../shared/src/index.js";

interface CheckDbRow {
  id: string;
  domain_id: string;
  checked_at: string;
  success: boolean;
  status: SslCheckResult["status"];
  valid_from: string | null;
  valid_until: string | null;
  days_remaining: number | null;
  issuer: string | null;
  subject: string | null;
  dns_names: unknown;
  tls_version: string | null;
  chain_valid: boolean | null;
  chain_info: unknown;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
}

export interface CheckRow extends SslCheckResult {
  id: string;
  domain_id: string;
  checked_at: string;
}

function asDnsNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toCheckRow(row: CheckDbRow): CheckRow {
  return {
    id: row.id,
    domain_id: row.domain_id,
    checked_at: row.checked_at,
    hostname: "",
    success: row.success,
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    daysRemaining: row.days_remaining,
    issuer: row.issuer,
    subject: row.subject,
    dnsNames: asDnsNames(row.dns_names),
    tlsVersion: row.tls_version,
    chainValid: row.chain_valid,
    chainInfo: row.chain_info,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    latencyMs: row.latency_ms ?? 0,
  };
}

export async function saveCheck(
  domainId: string,
  result: SslCheckResult,
  executor: QueryExecutor = { query },
): Promise<CheckRow> {
  const r = await executor.query<CheckDbRow>(
    `INSERT INTO ssl_checks(domain_id,success,status,valid_from,valid_until,days_remaining,issuer,subject,dns_names,tls_version,chain_valid,chain_info,error_code,error_message,latency_ms)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      domainId,
      result.success,
      result.status,
      result.validFrom,
      result.validUntil,
      result.daysRemaining,
      result.issuer,
      result.subject,
      JSON.stringify(result.dnsNames),
      result.tlsVersion,
      result.chainValid,
      result.chainInfo ? JSON.stringify(result.chainInfo) : null,
      result.errorCode,
      result.errorMessage,
      result.latencyMs,
    ],
  );
  return { ...toCheckRow(r.rows[0]), hostname: result.hostname };
}

export async function latestCheck(
  domainId: string,
  successfulOnly = false,
): Promise<CheckRow | null> {
  const sql = successfulOnly
    ? "SELECT s.*, d.hostname FROM ssl_checks s JOIN domains d ON d.id=s.domain_id WHERE s.domain_id=$1 AND s.success=true ORDER BY s.checked_at DESC LIMIT 1"
    : "SELECT s.*, d.hostname FROM ssl_checks s JOIN domains d ON d.id=s.domain_id WHERE s.domain_id=$1 ORDER BY s.checked_at DESC LIMIT 1";
  const row = (await query<CheckDbRow & { hostname: string }>(sql, [domainId]))
    .rows[0];
  return row ? { ...toCheckRow(row), hostname: row.hostname } : null;
}

export async function history(
  domainId: string,
  limit: number,
  cursor?: string,
): Promise<CheckRow[]> {
  const sql = cursor
    ? `SELECT s.*, d.hostname FROM ssl_checks s JOIN domains d ON d.id=s.domain_id
       WHERE s.domain_id=$1 AND s.checked_at < $2 ORDER BY s.checked_at DESC LIMIT $3`
    : `SELECT s.*, d.hostname FROM ssl_checks s JOIN domains d ON d.id=s.domain_id
       WHERE s.domain_id=$1 ORDER BY s.checked_at DESC LIMIT $2`;
  const values = cursor ? [domainId, cursor, limit] : [domainId, limit];
  return (await query<CheckDbRow & { hostname: string }>(sql, values)).rows.map(
    (row) => ({ ...toCheckRow(row), hostname: row.hostname }),
  );
}
