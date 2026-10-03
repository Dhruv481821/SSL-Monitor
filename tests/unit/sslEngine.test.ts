import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveSafeTargetMock } = vi.hoisted(() => ({
  resolveSafeTargetMock: vi.fn(),
}));

vi.mock("../../packages/domain/src/ssl/networkSafety.js", () => ({
  resolveSafeTarget: resolveSafeTargetMock,
}));

import tls from "node:tls";
import { EventEmitter } from "node:events";
import { inspectTls } from "../../packages/domain/src/ssl/engine.js";
import { UpstreamError } from "../../packages/shared/src/index.js";

function certificate(overrides: Record<string, unknown> = {}) {
  return {
    subject: { CN: "example.com" },
    issuer: { CN: "Test CA" },
    subjectaltname: "DNS:example.com, DNS:www.example.com",
    valid_from: "Jan 01 00:00:00 2026 GMT",
    valid_to: "Jan 01 00:00:00 2027 GMT",
    fingerprint256: "AA:BB:CC",
    serialNumber: "123456",
    ...overrides,
  } as tls.PeerCertificate;
}

function createSocket(options: {
  cert?: tls.PeerCertificate;
  authorized?: boolean;
  authorizationError?: string | null;
  event?: "secureConnect" | "error" | "timeout";
  error?: NodeJS.ErrnoException;
}) {
  const socket = new EventEmitter() as tls.TLSSocket & {
    authorized: boolean;
    authorizationError: string | null;
    destroyed: boolean;
    getPeerCertificate: (detailed?: boolean) => tls.PeerCertificate;
    getProtocol: () => string;
    destroy: () => tls.TLSSocket;
    end: () => tls.TLSSocket;
  };

  socket.authorizationError = (options.authorizationError ?? undefined) as any;
  socket.authorized = options.authorized ?? true;

  socket.getPeerCertificate = (() => options.cert ?? certificate()) as any;

  socket.getProtocol = () => "TLSv1.3";

  socket.destroy = () => {
    socket.destroyed = true;
    return socket;
  };

  socket.end = () => {
    socket.destroyed = true;
    return socket;
  };

  // Let inspectTls() attach all listeners first.
  setTimeout(() => {
    const event = options.event ?? "secureConnect";

    if (event === "error") {
      socket.emit(
        "error",
        options.error ??
          Object.assign(new Error("TLS connection failed"), {
            code: "ECONNREFUSED",
          }),
      );
      return;
    }

    socket.emit(event);
  }, 0);

  return socket;
}

describe("TLS engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resolveSafeTargetMock.mockReset();
  });

  function safeTarget() {
    resolveSafeTargetMock.mockResolvedValue({
      hostname: "example.com",
      address: "1.1.1.1",
      family: 4,
    });
  }

  it("inspects a valid certificate using the resolved IP and hostname SNI", async () => {
    safeTarget();

    const socket = createSocket({
      cert: certificate(),
      authorized: true,
    });

    const connectSpy = vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "1.1.1.1",
        port: 443,
        servername: "example.com",
        rejectUnauthorized: false,
        timeout: 1000,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("valid");
    expect(result.hostname).toBe("example.com");
    expect(result.subject).toBe("example.com");
    expect(result.issuer).toBe("Test CA");
    expect(result.dnsNames).toEqual(["example.com", "www.example.com"]);
    expect(result.tlsVersion).toBe("TLSv1.3");
    expect(result.chainValid).toBe(true);
    expect(result.errorCode).toBeNull();
  });

  it("reports hostname mismatch", async () => {
    safeTarget();

    const socket = createSocket({
      cert: certificate({
        subject: { CN: "wrong.example.com" },
        subjectaltname: "DNS:wrong.example.com",
      }),
      authorized: true,
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("HOSTNAME_MISMATCH");
    expect(result.errorMessage).toBe("Certificate hostname does not match");
  });

  it("reports an expired certificate", async () => {
    safeTarget();

    const socket = createSocket({
      cert: certificate({
        valid_from: "Jan 01 2024 00:00:00 GMT",
        valid_to: "Jan 01 2025 00:00:00 GMT",
      }),
      authorized: true,
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(false);
    expect(result.status).toBe("expired");
    expect(result.errorCode).toBe("CERT_EXPIRED");
    expect(result.errorMessage).toBe("Certificate is expired");
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it("reports an invalid certificate chain", async () => {
    safeTarget();

    const socket = createSocket({
      cert: certificate(),
      authorized: false,
      authorizationError: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("CERTIFICATE_ERROR");
    expect(result.errorMessage).toBe("Certificate validation failed");
  });

  it("normalizes connection errors", async () => {
    safeTarget();

    const error = Object.assign(new Error("internal connection details"), {
      code: "ECONNREFUSED",
    });

    const socket = createSocket({
      event: "error",
      error,
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("CONNECTION_ERROR");
    expect(result.errorMessage).toBe("TLS endpoint is unreachable");
    expect(result.errorMessage).not.toContain("internal connection details");
  });

  it("normalizes TLS timeout", async () => {
    safeTarget();

    const socket = createSocket({
      event: "timeout",
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TIMEOUT");
    expect(result.errorMessage).toBe("TLS connection timed out");
  });

  it("handles DNS timeout without opening a TLS connection", async () => {
    resolveSafeTargetMock.mockRejectedValue(
      new UpstreamError("DNS_TIMEOUT", "DNS resolution timed out"),
    );

    const connectSpy = vi.spyOn(tls, "connect");

    const result = await inspectTls("example.com", 25, 1000);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TIMEOUT");
    expect(result.errorMessage).toBe("DNS resolution timed out");
  });

  it("handles DNS failure without exposing resolver internals", async () => {
    resolveSafeTargetMock.mockRejectedValue(
      new UpstreamError("DNS_FAILURE", "resolver internal secret"),
    );

    const connectSpy = vi.spyOn(tls, "connect");

    const result = await inspectTls("example.com", 1000, 1000);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("DNS_FAILURE");
    expect(result.errorMessage).toBe("resolver internal secret");
  });

  it("limits certificate-chain traversal to a safe bounded depth", async () => {
    safeTarget();

    const root = certificate({
      fingerprint256: "CERT-0",
    }) as tls.PeerCertificate & {
      issuerCertificate?: tls.PeerCertificate;
    };

    let current = root;

    for (let index = 1; index <= 20; index++) {
      const next = certificate({
        fingerprint256: `CERT-${index}`,
      }) as tls.PeerCertificate & {
        issuerCertificate?: tls.PeerCertificate;
      };

      current.issuerCertificate = next;
      current = next;
    }

    const socket = createSocket({
      cert: root,
      authorized: true,
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(true);
    expect(result.chainInfo).toHaveLength(10);
  });

  it("stops certificate-chain traversal on a cycle", async () => {
    safeTarget();

    const first = certificate({
      fingerprint256: "CERT-A",
    }) as tls.PeerCertificate & {
      issuerCertificate?: tls.PeerCertificate;
    };

    const second = certificate({
      fingerprint256: "CERT-B",
    }) as tls.PeerCertificate & {
      issuerCertificate?: tls.PeerCertificate;
    };

    first.issuerCertificate = second;
    second.issuerCertificate = first;

    const socket = createSocket({
      cert: first,
      authorized: true,
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("example.com", 1000, 1000);

    expect(result.success).toBe(true);
    expect(result.chainInfo).toHaveLength(2);
  });

  it("keeps the hostname from the safe target", async () => {
    resolveSafeTargetMock.mockResolvedValue({
      hostname: "example.com",
      address: "1.1.1.1",
      family: 4,
    });

    const socket = createSocket({
      cert: certificate(),
      authorized: true,
    });

    vi.spyOn(tls, "connect").mockReturnValue(socket);

    const result = await inspectTls("EXAMPLE.COM.", 1000, 1000);

    expect(result.hostname).toBe("example.com");
  });
});
