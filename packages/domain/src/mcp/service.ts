import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  UnauthorizedError,
  ValidationError,
} from "../../../shared/src/index.js";

import * as repo from "./repository.js";

const API_KEY_PREFIX = "smcp_";
const KEY_RANDOM_BYTES = 32;

export interface AuthenticatedMcpKey {
  id: string;
  userId: string;
  name: string;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(KEY_RANDOM_BYTES).toString("base64url")}`;
}

function getPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 8);
}

export async function create(
  userId: string,
  name: string,
  expiresAt: Date | null = null,
): Promise<{
  key: string;
  id: string;
  name: string;
  expiresAt: string | null;
}> {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new ValidationError("API key name is required");
  }

  if (normalizedName.length > 100) {
    throw new ValidationError("API key name is too long");
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ValidationError("API key expiry must be in the future");
  }

  const key = generateApiKey();
  const keyPrefix = getPrefix(key);
  const keyHash = hashKey(key);

  const row = await repo.createApiKey(
    userId,
    keyPrefix,
    keyHash,
    normalizedName,
    expiresAt,
  );

  return {
    key,
    id: row.id,
    name: row.name,
    expiresAt: row.expires_at,
  };
}

export async function authenticate(
  presentedKey: string,
): Promise<AuthenticatedMcpKey> {
  if (!presentedKey || !presentedKey.startsWith(API_KEY_PREFIX)) {
    throw new UnauthorizedError("Invalid MCP API key");
  }

  const keyPrefix = getPrefix(presentedKey);
  const row = await repo.findByPrefix(keyPrefix);

  if (!row) {
    throw new UnauthorizedError("Invalid MCP API key");
  }

  const presentedHash = hashKey(presentedKey);

  if (!safeHashEqual(presentedHash, row.key_hash)) {
    throw new UnauthorizedError("Invalid MCP API key");
  }

  if (row.revoked_at) {
    throw new UnauthorizedError("MCP API key has been revoked");
  }

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new UnauthorizedError("MCP API key has expired");
  }

  await repo.markUsed(row.id);

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
  };
}

export async function list(userId: string) {
  return repo.listForUser(userId);
}

export async function revoke(userId: string, keyId: string) {
  return repo.revokeForUser(userId, keyId);
}
