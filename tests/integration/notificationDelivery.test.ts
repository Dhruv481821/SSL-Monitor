import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConfig } from "../../packages/config/src/index.js";
import {
  dispatchAlert,
  type EmailMessage,
  type EmailProvider,
} from "../../packages/domain/src/notifications/delivery.js";
import {
  upsertOpenAlert,
  type AlertRow,
} from "../../packages/domain/src/alerts/repository.js";

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("notification delivery integration", () => {
  let query: typeof import("../../packages/db/src/client.js").query;
  let pool: typeof import("../../packages/db/src/client.js").pool;
  const originalNotificationEnv = {
    retryDelay: process.env.NOTIFICATION_RETRY_DELAY_MS,
    maxRetryDelay: process.env.NOTIFICATION_MAX_RETRY_DELAY_MS,
    maxAttempts: process.env.NOTIFICATION_RETRY_MAX_ATTEMPTS,
    smtpHost: process.env.SMTP_HOST,
    smtpFrom: process.env.SMTP_FROM,
  };

  beforeAll(async () => {
    process.env.NOTIFICATION_RETRY_DELAY_MS = "100";
    process.env.NOTIFICATION_MAX_RETRY_DELAY_MS = "100";
    process.env.NOTIFICATION_RETRY_MAX_ATTEMPTS = "1";
    process.env.SMTP_HOST = "";
    process.env.SMTP_FROM = "";
    getConfig({ ...process.env });
    expect(getConfig().NOTIFICATION_RETRY_MAX_ATTEMPTS).toBe(1);

    const db = await import("../../packages/db/src/client.js");
    query = db.query;
    pool = db.pool;
  });

  afterAll(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("NOTIFICATION_RETRY_DELAY_MS", originalNotificationEnv.retryDelay);
    restore(
      "NOTIFICATION_MAX_RETRY_DELAY_MS",
      originalNotificationEnv.maxRetryDelay,
    );
    restore(
      "NOTIFICATION_RETRY_MAX_ATTEMPTS",
      originalNotificationEnv.maxAttempts,
    );
    restore("SMTP_HOST", originalNotificationEnv.smtpHost);
    restore("SMTP_FROM", originalNotificationEnv.smtpFrom);
    if (pool) await pool.end();
  });

  async function createFixture(
    label: string,
  ): Promise<{ userId: string; domainId: string; alert: AlertRow }> {
    const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await query<{ id: string }>(
      "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id",
      [`phase06-notification-${suffix}@example.com`, "test-hash"],
    );
    const userId = user.rows[0].id;
    const domain = await query<{ id: string }>(
      "INSERT INTO domains(user_id,hostname) VALUES($1,$2) RETURNING id",
      [userId, `phase06-notification-${suffix}.example.com`],
    );
    const domainId = domain.rows[0].id;
    const result = await upsertOpenAlert({
      userId,
      domainId,
      type: "ssl_check_failure",
      severity: "critical",
      fingerprint: `notification-test:${suffix}`,
      message: "SSL/TLS check failed for notification delivery test",
    });
    return { userId, domainId, alert: result.alert };
  }

  async function cleanup(userId: string): Promise<void> {
    await query("DELETE FROM users WHERE id=$1", [userId]);
  }

  async function getDelivery(alertId: string, channel: "webhook" | "email") {
    const result = await query<{
      status: "pending" | "delivered" | "failed";
      attempt_count: number;
      next_attempt_at: string | null;
      delivered_at: string | null;
      last_error: string | null;
    }>(
      "SELECT status,attempt_count,next_attempt_at,delivered_at,last_error FROM alert_deliveries WHERE alert_id=$1 AND channel=$2",
      [alertId, channel],
    );
    return result.rows[0] ?? null;
  }

  it("records a successful webhook delivery as one delivered attempt", async () => {
    const fixture = await createFixture("webhook-success");
    const observedBeforeSend: Array<{ status: string; attemptCount: number }> =
      [];

    try {
      let calls = 0;
      await dispatchAlert(
        fixture.alert,
        {
          emailEnabled: false,
          emailAddress: null,
          webhookEnabled: true,
          webhookUrl: "https://hooks.example.com/ssl-monitor",
        },
        {
          webhookSender: async () => {
            calls += 1;
            const delivery = await getDelivery(fixture.alert.id, "webhook");
            expect(delivery).not.toBeNull();
            observedBeforeSend.push({
              status: delivery!.status,
              attemptCount: delivery!.attempt_count,
            });
            return { statusCode: 200 };
          },
        },
      );

      const delivery = await getDelivery(fixture.alert.id, "webhook");
      expect(calls).toBe(1);
      expect(observedBeforeSend).toEqual([
        { status: "pending", attemptCount: 0 },
      ]);
      expect(delivery).toMatchObject({
        status: "delivered",
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
      });
      expect(delivery?.delivered_at).not.toBeNull();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("retries a failed webhook and persists terminal failure without leaking webhook secrets", async () => {
    const fixture = await createFixture("webhook-failure");
    const observedBeforeAttempts: Array<{
      status: string;
      attemptCount: number;
      nextAttemptAt: string | null;
    }> = [];
    const webhookUrl = "https://hooks.example.com/ssl-monitor";
    let calls = 0;

    try {
      await dispatchAlert(
        fixture.alert,
        {
          emailEnabled: false,
          emailAddress: null,
          webhookEnabled: true,
          webhookUrl,
        },
        {
          webhookSender: async () => {
            calls += 1;
            const delivery = await getDelivery(fixture.alert.id, "webhook");
            expect(delivery).not.toBeNull();
            observedBeforeAttempts.push({
              status: delivery!.status,
              attemptCount: delivery!.attempt_count,
              nextAttemptAt: delivery!.next_attempt_at,
            });
            throw new Error("Webhook delivery failed");
          },
        },
      );

      const delivery = await getDelivery(fixture.alert.id, "webhook");
      expect(calls).toBe(2);
      expect(observedBeforeAttempts).toHaveLength(2);
      expect(observedBeforeAttempts[0]).toEqual({
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: null,
      });
      expect(observedBeforeAttempts[1].status).toBe("pending");
      expect(observedBeforeAttempts[1].attemptCount).toBe(1);
      expect(observedBeforeAttempts[1].nextAttemptAt).not.toBeNull();
      expect(delivery).toMatchObject({
        status: "failed",
        attempt_count: 2,
        next_attempt_at: null,
        delivered_at: null,
      });
      expect(delivery?.last_error).toBe("Webhook delivery failed");
      expect(delivery?.last_error).not.toContain(webhookUrl);
      expect(delivery?.last_error).not.toContain("webhook credentials");
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("records a successful email-provider delivery with the expected message", async () => {
    const fixture = await createFixture("email-success");
    const messages: EmailMessage[] = [];
    const provider: EmailProvider = {
      send: async (message) => {
        messages.push(message);
      },
    };

    try {
      await dispatchAlert(
        fixture.alert,
        {
          emailEnabled: true,
          emailAddress: "alerts@example.com",
          webhookEnabled: false,
          webhookUrl: null,
        },
        { emailProvider: provider },
      );

      const delivery = await getDelivery(fixture.alert.id, "email");
      expect(messages).toEqual([
        {
          to: "alerts@example.com",
          subject: "[SSL Monitor] critical: ssl_check_failure",
          text: expect.stringContaining(`Domain: ${fixture.alert.domain_id}`),
        },
      ]);
      expect(messages[0].text).toContain(`Alert: ${fixture.alert.id}`);
      expect(delivery).toMatchObject({
        status: "delivered",
        attempt_count: 1,
        next_attempt_at: null,
        last_error: null,
      });
      expect(delivery?.delivered_at).not.toBeNull();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("isolates missing SMTP configuration and persists terminal email failure without corrupting the alert", async () => {
    const fixture = await createFixture("email-unavailable");

    try {
      await dispatchAlert(fixture.alert, {
        emailEnabled: true,
        emailAddress: "alerts@example.com",
        webhookEnabled: false,
        webhookUrl: null,
      });

      const delivery = await getDelivery(fixture.alert.id, "email");
      const alert = await query<{ id: string; state: string }>(
        "SELECT id,state FROM alerts WHERE id=$1",
        [fixture.alert.id],
      );
      expect(delivery).toMatchObject({
        status: "failed",
        attempt_count: 2,
        next_attempt_at: null,
        delivered_at: null,
        last_error: "Email provider is not configured",
      });
      expect(alert.rows).toEqual([{ id: fixture.alert.id, state: "open" }]);
    } finally {
      await cleanup(fixture.userId);
    }
  });
});
