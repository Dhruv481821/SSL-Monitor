import { describe, expect, it } from "vitest";
import { evaluateAlertEvents } from "../../packages/domain/src/alerts/service.js";
import type { SslCheckResult } from "../../packages/shared/src/index.js";

const baseResult: SslCheckResult = {
  hostname: "example.com",
  success: true,
  status: "valid",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-11-01T00:00:00.000Z",
  daysRemaining: 30,
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

function result(overrides: Partial<SslCheckResult>): SslCheckResult {
  return { ...baseResult, ...overrides };
}

describe("alert evaluation", () => {
  it("creates one expiry event per crossed configured threshold", () => {
    const events = evaluateAlertEvents({
      userId: "user",
      domainId: "domain",
      hostname: "example.com",
      result: result({ daysRemaining: 7 }),
      expiryThresholdDays: [30, 14, 7, 1],
      consecutiveFailures: 0,
    });

    expect(
      events.filter((event) => event.type === "certificate_expiring"),
    ).toHaveLength(3);
    expect(
      events
        .filter((event) => event.type === "certificate_expiring")
        .map((event) => event.fingerprint),
    ).toEqual([
      "certificate_expiring:domain:30",
      "certificate_expiring:domain:14",
      "certificate_expiring:domain:7",
    ]);
  });

  it("classifies expired certificates separately from generic TLS failures", () => {
    const events = evaluateAlertEvents({
      userId: "user",
      domainId: "domain",
      hostname: "example.com",
      result: result({
        success: false,
        status: "expired",
        errorCode: "CERT_EXPIRED",
        daysRemaining: -1,
      }),
      expiryThresholdDays: [30, 14, 7, 1],
      consecutiveFailures: 1,
    });

    expect(events.map((event) => event.type)).toContain("certificate_expired");
    expect(events.map((event) => event.type)).toContain("domain_unhealthy");
    expect(events.map((event) => event.type)).not.toContain(
      "ssl_check_failure",
    );
  });

  it("classifies certificate validation failures separately", () => {
    const events = evaluateAlertEvents({
      userId: "user",
      domainId: "domain",
      hostname: "example.com",
      result: result({
        success: false,
        status: "error",
        errorCode: "HOSTNAME_MISMATCH",
      }),
      expiryThresholdDays: [30, 14, 7, 1],
      consecutiveFailures: 1,
    });

    expect(events.map((event) => event.type)).toContain("invalid_certificate");
    expect(events.map((event) => event.type)).toContain("domain_unhealthy");
    expect(events.map((event) => event.type)).not.toContain(
      "ssl_check_failure",
    );
  });

  it("classifies network/TLS failures and unhealthy state", () => {
    const events = evaluateAlertEvents({
      userId: "user",
      domainId: "domain",
      hostname: "example.com",
      result: result({ success: false, status: "error", errorCode: "TIMEOUT" }),
      expiryThresholdDays: [30, 14, 7, 1],
      consecutiveFailures: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      "ssl_check_failure",
      "domain_unhealthy",
    ]);
  });

  it("does not emit alert events for a healthy certificate outside thresholds", () => {
    const events = evaluateAlertEvents({
      userId: "user",
      domainId: "domain",
      hostname: "example.com",
      result: result({ daysRemaining: 90 }),
      expiryThresholdDays: [30, 14, 7, 1],
      consecutiveFailures: 0,
    });

    expect(events).toEqual([]);
  });
});
