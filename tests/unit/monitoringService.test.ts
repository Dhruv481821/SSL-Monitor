import { describe, expect, it } from "vitest";
import {
  calculateNextCheckAt,
  runBoundedCheck,
} from "../../packages/domain/src/monitoring/service.js";

describe("monitoring scheduling", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  it("schedules the normal interval after success and resets retries", () => {
    const result = calculateNextCheckAt(now, true, 2, 60_000, 3, 3_600_000);
    expect(result.retryScheduled).toBe(false);
    expect(result.retryCount).toBe(0);
    expect(result.nextCheckAt.toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });

  it("uses exponential retry backoff without exceeding the normal interval", () => {
    const result = calculateNextCheckAt(now, false, 2, 60_000, 3, 3_600_000);
    expect(result.retryScheduled).toBe(true);
    expect(result.retryCount).toBe(3);
    expect(result.nextCheckAt.toISOString()).toBe("2026-10-01T10:04:00.000Z");
  });

  it("returns a timeout fallback instead of waiting indefinitely", async () => {
    const result = await runBoundedCheck(
      new Promise<string>(() => undefined),
      5,
      () => "timeout",
    );
    expect(result).toBe("timeout");
  });

  it("returns to the normal schedule after retry exhaustion", () => {
    const result = calculateNextCheckAt(now, false, 3, 60_000, 3, 3_600_000);
    expect(result.retryScheduled).toBe(false);
    expect(result.retryCount).toBe(0);
    expect(result.nextCheckAt.toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });
});
