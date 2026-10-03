import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { query } from "../../../db/src/client.js";
import { ConflictError, AppError } from "../../../shared/src/index.js";
import { getConfig } from "../../../config/src/index.js";

export interface PublicUser {
  id: string;
  email: string;
}
export async function register(
  email: string,
  password: string,
): Promise<{ user: PublicUser; token: string }> {
  const normalized = email.trim().toLowerCase();
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  try {
    const r = await query<{ id: string; email: string }>(
      "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email",
      [normalized, hash],
    );
    const user = r.rows[0];
    return { user, token: sign(user.id, user.email) };
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "23505")
      throw new ConflictError("Email already exists");
    throw e;
  }
}
export async function login(
  email: string,
  password: string,
): Promise<{ user: PublicUser; token: string }> {
  const normalized = email.trim().toLowerCase();
  const r = await query<{ id: string; email: string; password_hash: string }>(
    "SELECT id,email,password_hash FROM users WHERE email=$1",
    [normalized],
  );
  const row = r.rows[0];
  if (!row || !(await argon2.verify(row.password_hash, password)))
    throw new AppError("INVALID_CREDENTIALS", "Invalid credentials", 401);
  return {
    user: { id: row.id, email: row.email },
    token: sign(row.id, row.email),
  };
}
function sign(id: string, email: string) {
  return jwt.sign({ sub: id, email }, getConfig().JWT_SECRET, {
    expiresIn: getConfig().JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}
export function verifyToken(token: string): { id: string; email: string } {
  const payload = jwt.verify(token, getConfig().JWT_SECRET, {
    algorithms: ["HS256"],
  });
  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string"
  ) {
    throw new AppError("INVALID_TOKEN", "Invalid token", 401);
  }
  return { id: payload.sub, email: payload.email };
}
