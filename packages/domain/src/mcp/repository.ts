import { query } from "../../../db/src/client.js";

export interface McpApiKeyRow {
  id: string;
  user_id: string;
  key_prefix: string;
  key_hash: string;
  name: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function createApiKey(
  userId: string,
  keyPrefix: string,
  keyHash: string,
  name: string,
  expiresAt: Date | null,
): Promise<McpApiKeyRow> {
  const result = await query<McpApiKeyRow>(
    `INSERT INTO mcp_api_keys
      (user_id, key_prefix, key_hash, name, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, keyPrefix, keyHash, name, expiresAt?.toISOString() ?? null],
  );

  return result.rows[0];
}

export async function findByPrefix(
  keyPrefix: string,
): Promise<McpApiKeyRow | null> {
  const result = await query<McpApiKeyRow>(
    `SELECT *
     FROM mcp_api_keys
     WHERE key_prefix = $1
     LIMIT 1`,
    [keyPrefix],
  );

  return result.rows[0] ?? null;
}

export async function markUsed(id: string): Promise<void> {
  await query(
    `UPDATE mcp_api_keys
     SET last_used_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function listForUser(userId: string): Promise<McpApiKeyRow[]> {
  const result = await query<McpApiKeyRow>(
    `SELECT *
     FROM mcp_api_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return result.rows;
}

export async function revokeForUser(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE mcp_api_keys
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = $1
       AND user_id = $2`,
    [keyId, userId],
  );

  return result.rowCount === 1;
}
