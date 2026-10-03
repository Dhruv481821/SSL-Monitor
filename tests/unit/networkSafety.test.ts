import { afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import {
  assertAllAddressesSafe,
  assertSafeAddress,
  normalizeHostname,
  resolveSafeTarget,
} from "../../packages/domain/src/ssl/networkSafety.js";

describe("network safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes valid hostnames", () => {
    expect(normalizeHostname("Example.COM.")).toBe("example.com");
    expect(normalizeHostname("  Example.COM  ")).toBe("example.com");
  });

  it("rejects URLs and IP literals", () => {
    expect(() => normalizeHostname("https://example.com")).toThrow();
    expect(() => normalizeHostname("http://example.com")).toThrow();
    expect(() => normalizeHostname("127.0.0.1")).toThrow();
    expect(() => normalizeHostname("::1")).toThrow();
    expect(() => normalizeHostname("example.com:443")).toThrow();
    expect(() => normalizeHostname("example.com/path")).toThrow();
    expect(() => normalizeHostname("example.com?x=1")).toThrow();
    expect(() => normalizeHostname("user@example.com")).toThrow();
  });

  it("rejects local and invalid hostnames", () => {
    expect(() => normalizeHostname("localhost")).toThrow();
    expect(() => normalizeHostname("foo.localhost")).toThrow();
    expect(() => normalizeHostname("foo.local")).toThrow();
    expect(() => normalizeHostname("")).toThrow();
    expect(() => normalizeHostname("-example.com")).toThrow();
    expect(() => normalizeHostname("example-.com")).toThrow();
    expect(() => normalizeHostname("example..com")).toThrow();
  });

  for (const ip of [
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
  ]) {
    it(`blocks ${ip}`, () => {
      expect(() => assertSafeAddress(ip)).toThrow();
    });
  }

  it("allows public IPv4 and IPv6 addresses", () => {
    expect(() => assertSafeAddress("1.1.1.1")).not.toThrow();
    expect(() => assertSafeAddress("8.8.8.8")).not.toThrow();
    expect(() => assertSafeAddress("2606:4700:4700::1111")).not.toThrow();
  });

  it("rejects malformed addresses", () => {
    expect(() => assertSafeAddress("not-an-ip")).toThrow();
    expect(() => assertSafeAddress("999.999.999.999")).toThrow();
    expect(() => assertSafeAddress("gggg::1")).toThrow();
  });

  it("rejects an empty DNS answer set", () => {
    expect(() => assertAllAddressesSafe([])).toThrow();
  });

  it("rejects a mixed public/private DNS answer set", () => {
    expect(() => assertAllAddressesSafe(["1.1.1.1", "127.0.0.1"])).toThrow();
  });

  it("rejects a mixed public/private IPv6 DNS answer set", () => {
    expect(() =>
      assertAllAddressesSafe(["2606:4700:4700::1111", "fc00::1"]),
    ).toThrow();
  });

  it("resolves a public IPv4 target and selects IPv4 when available", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ] as any);

    await expect(resolveSafeTarget("Example.COM.", 1000)).resolves.toEqual({
      hostname: "example.com",
      address: "1.1.1.1",
      family: 4,
    });
  });

  it("falls back to a public IPv6 target when no IPv4 answer exists", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "2606:4700:4700::1111", family: 6 },
    ] as any);

    await expect(resolveSafeTarget("Example.COM", 1000)).resolves.toEqual({
      hostname: "example.com",
      address: "2606:4700:4700::1111",
      family: 6,
    });
  });

  it("rejects DNS results containing any unsafe address", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ] as any);

    await expect(resolveSafeTarget("example.com", 1000)).rejects.toThrow(
      "Target resolves to a blocked network address",
    );
  });

  it("normalizes DNS failures without exposing upstream details", async () => {
    vi.spyOn(dns, "lookup").mockRejectedValue(
      Object.assign(new Error("resolver internal failure"), {
        code: "EAI_AGAIN",
      }),
    );

    await expect(resolveSafeTarget("example.com", 1000)).rejects.toMatchObject({
      code: "DNS_FAILURE",
      message: "DNS resolution failed",
    });
  });

  it("enforces the DNS timeout", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(
      () =>
        new Promise(() => {
          // Intentionally never resolves.
        }),
    );

    const started = Date.now();

    await expect(resolveSafeTarget("example.com", 25)).rejects.toMatchObject({
      code: "DNS_TIMEOUT",
      message: "DNS resolution timed out",
    });

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not select a safe answer when another DNS answer is unsafe", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "192.168.1.1", family: 4 },
    ] as any);

    await expect(resolveSafeTarget("example.com", 1000)).rejects.toMatchObject({
      code: "UNSAFE_TARGET",
    });
  });
});
