import { describe, expect, it, vi } from "vitest";
import {
  MonitoringWorker,
  type WorkerDependencies,
} from "../../apps/worker/src/worker.js";
import type { Config } from "../../packages/config/src/index.js";
import type { DomainRow } from "../../packages/domain/src/domains/repository.js";

function config(): Config {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3000,
    DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:5432/test",
    JWT_SECRET: "phase05-test-secret-that-is-long-enough-123456",
    JWT_EXPIRES_IN: "15m",
    TLS_TIMEOUT_MS: 1000,
    DNS_TIMEOUT_MS: 500,
    CORS_ORIGIN: "http://localhost:5173",
    API_RATE_LIMIT_PER_MINUTE: 120,
    LOGIN_RATE_LIMIT_PER_MINUTE: 10,
    MANUAL_CHECK_RATE_LIMIT_PER_MINUTE: 20,
    MCP_RATE_LIMIT_PER_MINUTE: 60,
    MONITOR_POLL_INTERVAL_MS: 1000,
    MONITOR_WORKER_CONCURRENCY: 2,
    MONITOR_CHECK_TIMEOUT_MS: 1000,
    MONITOR_RETRY_DELAY_MS: 1000,
    MONITOR_RETRY_MAX_ATTEMPTS: 3,
    MONITOR_STALE_CLAIM_TIMEOUT_MS: 5000,
    MONITOR_BATCH_SIZE: 10,
    MONITOR_INTERVAL_MS: 3600000,
    MONITOR_SHUTDOWN_TIMEOUT_MS: 1000,
    NOTIFICATION_TIMEOUT_MS: 5000,
    NOTIFICATION_RETRY_DELAY_MS: 1000,
    NOTIFICATION_MAX_RETRY_DELAY_MS: 30000,
    NOTIFICATION_RETRY_MAX_ATTEMPTS: 2,
    SMTP_PORT: 465,
    SMTP_SECURE: true,
  };
}

function domain(id: string): DomainRow {
  return {
    id,
    user_id: "user-1",
    hostname: `${id}.example.com`,
    status: "unknown",
    monitoring_enabled: true,
    last_checked_at: null,
    next_check_at: null,
    last_success_at: null,
    consecutive_failures: 0,
    monitoring_claimed_at: new Date().toISOString(),
    monitoring_claim_token: `token-${id}`,
    monitoring_retry_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("monitoring worker", () => {
  it("respects configured concurrency and isolates one failing domain", async () => {
    const domains = [
      domain("one"),
      domain("two"),
      domain("three"),
      domain("four"),
    ];
    let active = 0;
    let maxActive = 0;
    const completed: string[] = [];
    const released: string[] = [];

    const deps: WorkerDependencies = {
      config: config(),
      claimDueDomains: vi.fn(async () => ({ domains, recoveredStale: 0 })),
      executeScheduledCheck: vi.fn(async (d) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        completed.push(d.id);
        if (d.id === "two") throw new Error("simulated failure");
        return {
          result: { success: true, status: "valid" },
          nextCheckAt: new Date("2026-10-01T11:00:00.000Z"),
          retryCount: 0,
          retryScheduled: false,
          row: {},
          state: {},
        };
      }) as WorkerDependencies["executeScheduledCheck"],
      releaseMonitoringClaim: vi.fn(async (id) => {
        released.push(id);
      }),
      closeDatabase: vi.fn(async () => undefined),
      log: vi.fn(),
    };

    const worker = new MonitoringWorker(deps);
    await worker.runCycle();

    expect(maxActive).toBe(2);
    expect(completed).toEqual(["one", "two", "three", "four"]);
    expect(released).toEqual(["two"]);
    expect(deps.executeScheduledCheck).toHaveBeenCalledTimes(4);
  });
});
