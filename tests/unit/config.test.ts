import { describe, expect, it } from "vitest";
import { getConfig } from "../../packages/config/src/index.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_SECRET: "x".repeat(32),
} as NodeJS.ProcessEnv;

describe("SMTP_SECURE parsing", () => {
  it("defaults to true when unset or empty", () => {
    expect(getConfig({ ...base }).SMTP_SECURE).toBe(true);
    expect(getConfig({ ...base, SMTP_SECURE: "" }).SMTP_SECURE).toBe(true);
  });

  it("treats the string 'false' as false", () => {
    expect(getConfig({ ...base, SMTP_SECURE: "false" }).SMTP_SECURE).toBe(
      false,
    );
    expect(getConfig({ ...base, SMTP_SECURE: "FALSE" }).SMTP_SECURE).toBe(
      false,
    );
  });

  it("treats the string 'true' as true", () => {
    expect(getConfig({ ...base, SMTP_SECURE: "true" }).SMTP_SECURE).toBe(true);
  });

  it("rejects ambiguous values instead of guessing", () => {
    expect(() => getConfig({ ...base, SMTP_SECURE: "yes" })).toThrow();
  });
});
