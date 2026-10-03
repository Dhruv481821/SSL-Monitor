import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SslCheckResult } from "../../packages/shared/src/index.js";
import { evaluateAndPersist } from "../../packages/domain/src/alerts/service.js";
import { listAlerts } from "../../packages/domain/src/alerts/repository.js";

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

const healthyResult: SslCheckResult = {
  hostname: "example.com",
  success: true,
  status: "valid",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-12-30T00:00:00.000Z",
  daysRemaining: 90,
  issuer: "Example CA",
  subject: "example.com",
  dnsNames: ["example.com"],
  tlsVersion: "TLSv1.3",
  chainValid: true,
  chainInfo: [],
  errorCode: null,
  errorMessage: null,
  latencyMs: 10,
};

suite("alert lifecycle integration", () => {
  let query: typeof import("../../packages/db/src/client.js").query;
  let pool: typeof import("../../packages/db/src/client.js").pool;

  beforeAll(async () => {
    const db = await import("../../packages/db/src/client.js");
    query = db.query;
    pool = db.pool;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("deduplicates ongoing alerts and emits a recovery event only on recovery", async () => {
    const suffix = Date.now();
    const user = await query<{ id: string }>(
      "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id",
      [`phase06-alert-${suffix}@example.com`, "test-hash"],
    );
    const userId = user.rows[0].id;
    const domain = await query<{ id: string }>(
      "INSERT INTO domains(user_id,hostname) VALUES($1,$2) RETURNING id",
      [userId, `phase06-alert-${suffix}.example.com`],
    );
    const domainId = domain.rows[0].id;

    try {
      const failure: SslCheckResult = {
        ...healthyResult,
        hostname: `phase06-alert-${suffix}.example.com`,
        success: false,
        status: "error",
        daysRemaining: null,
        errorCode: "TIMEOUT",
        errorMessage: "TLS connection timed out",
      };

      const first = await evaluateAndPersist({
        userId,
        domainId,
        hostname: failure.hostname,
        result: failure,
        expiryThresholdDays: [30, 14, 7, 1],
        consecutiveFailures: 1,
      });
      expect(first.map((event) => event.alert.type)).toEqual([
        "ssl_check_failure",
        "domain_unhealthy",
      ]);

      const second = await evaluateAndPersist({
        userId,
        domainId,
        hostname: failure.hostname,
        result: failure,
        expiryThresholdDays: [30, 14, 7, 1],
        consecutiveFailures: 2,
      });
      expect(second).toHaveLength(0);

      const recovery = await evaluateAndPersist({
        userId,
        domainId,
        hostname: failure.hostname,
        result: { ...healthyResult, hostname: failure.hostname },
        expiryThresholdDays: [30, 14, 7, 1],
        consecutiveFailures: 0,
      });
      expect(recovery.map((event) => event.alert.type)).toEqual([
        "domain_recovered",
      ]);

      const alerts = await listAlerts(userId, undefined, 20);
      expect(
        alerts.filter(
          (alert) =>
            alert.type === "ssl_check_failure" && alert.state === "open",
        ),
      ).toHaveLength(0);
      expect(
        alerts.filter(
          (alert) =>
            alert.type === "domain_unhealthy" && alert.state === "open",
        ),
      ).toHaveLength(0);
      expect(
        alerts.filter(
          (alert) =>
            alert.type === "domain_recovered" && alert.state === "resolved",
        ),
      ).toHaveLength(1);
    } finally {
      await query("DELETE FROM users WHERE id=$1", [userId]);
    }
  });
});
