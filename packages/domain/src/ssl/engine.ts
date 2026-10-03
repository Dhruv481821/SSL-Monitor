import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { resolveSafeTarget } from "./networkSafety.js";
import { UpstreamError } from "../../../shared/src/index.js";
import type { SslCheckResult } from "../../../shared/src/index.js";

type PeerCertificateWithChain = tls.PeerCertificate & {
  issuerCertificate?: PeerCertificateWithChain;
};

interface CertificateChainEntry {
  subject: unknown;
  issuer: unknown;
  validFrom: string | null;
  validUntil: string | null;
  fingerprint256: string | null;
}

function daysRemaining(validUntil: string) {
  return Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86400000);
}

function names(cert: tls.PeerCertificate): string[] {
  if (typeof cert.subjectaltname !== "string") return [];

  const dnsNames: string[] = cert.subjectaltname
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is string => value.startsWith("DNS:"))
    .map((value) => value.slice(4));

  return [...new Set(dnsNames)];
}

function chainInfo(cert: PeerCertificateWithChain): CertificateChainEntry[] {
  const out: CertificateChainEntry[] = [];
  const seen = new Set<string>();
  let current: PeerCertificateWithChain | undefined = cert;
  let depth = 0;

  while (current && depth < 10) {
    const key = String(current.fingerprint256 || current.serialNumber || depth);
    if (seen.has(key)) break;
    seen.add(key);
    out.push({
      subject: current.subject,
      issuer: current.issuer,
      validFrom: current.valid_from || null,
      validUntil: current.valid_to || null,
      fingerprint256: current.fingerprint256 || null,
    });
    current = current.issuerCertificate;
    depth++;
  }

  return out;
}

function normalizeCertificateName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const values = value.filter(
      (entry): entry is string => typeof entry === "string",
    );
    return values.length > 0 ? values.join(", ") : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const commonName = record.CN;
    if (typeof commonName === "string") return commonName;
    if (Array.isArray(commonName)) {
      const values = commonName.filter(
        (entry): entry is string => typeof entry === "string",
      );
      if (values.length > 0) return values.join(", ");
    }
    try {
      return JSON.stringify(value) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function classifyError(err: unknown) {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String(err.code)
      : "TLS_ERROR";
  if (code === "ETIMEDOUT")
    return ["TIMEOUT", "TLS connection timed out"] as const;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return ["DNS_FAILURE", "DNS resolution failed"] as const;
  if (
    code === "ECONNREFUSED" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  )
    return ["CONNECTION_ERROR", "TLS endpoint is unreachable"] as const;
  if (code === "CERT_HAS_EXPIRED")
    return ["CERT_EXPIRED", "Certificate is expired"] as const;
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID")
    return [
      "HOSTNAME_MISMATCH",
      "Certificate hostname does not match",
    ] as const;
  if (code.startsWith("CERT_") || code.startsWith("UNABLE_TO_"))
    return ["CERTIFICATE_ERROR", "Certificate validation failed"] as const;
  return ["TLS_ERROR", "TLS inspection failed"] as const;
}

export async function inspectTls(
  hostnameInput: string,
  dnsTimeoutMs: number,
  tlsTimeoutMs: number,
): Promise<SslCheckResult> {
  const started = performance.now();
  let target;
  try {
    target = await resolveSafeTarget(hostnameInput, dnsTimeoutMs);
  } catch (e: unknown) {
    const code =
      e instanceof UpstreamError && e.code === "DNS_TIMEOUT"
        ? "TIMEOUT"
        : e instanceof UpstreamError
          ? e.code
          : "DNS_FAILURE";
    const message = e instanceof Error ? e.message : "DNS resolution failed";
    return {
      hostname: hostnameInput,
      success: false,
      status: "error",
      validFrom: null,
      validUntil: null,
      daysRemaining: null,
      issuer: null,
      subject: null,
      dnsNames: [],
      tlsVersion: null,
      chainValid: null,
      chainInfo: null,
      errorCode: code,
      errorMessage: message,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let socket: tls.TLSSocket | undefined;

    const finish = (result: SslCheckResult) => {
      if (!settled) {
        settled = true;
        resolve({
          ...result,
          latencyMs: Math.round(performance.now() - started),
        });
      }
    };

    const timer = setTimeout(() => {
      socket?.destroy();
      finish({
        hostname: target.hostname,
        success: false,
        status: "error",
        validFrom: null,
        validUntil: null,
        daysRemaining: null,
        issuer: null,
        subject: null,
        dnsNames: [],
        tlsVersion: null,
        chainValid: null,
        chainInfo: null,
        errorCode: "TIMEOUT",
        errorMessage: "TLS connection timed out",
        latencyMs: 0,
      });
    }, tlsTimeoutMs);

    socket = tls.connect({
      host: target.address,
      port: 443,
      servername: target.hostname,
      rejectUnauthorized: false,
      timeout: tlsTimeoutMs,
    });

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const currentSocket = socket;
      if (!currentSocket) {
        finish({
          hostname: target.hostname,
          success: false,
          status: "error",
          validFrom: null,
          validUntil: null,
          daysRemaining: null,
          issuer: null,
          subject: null,
          dnsNames: [],
          tlsVersion: null,
          chainValid: null,
          chainInfo: null,
          errorCode: "TLS_ERROR",
          errorMessage: "TLS socket is unavailable",
          latencyMs: 0,
        });
        return;
      }
      const cert = currentSocket.getPeerCertificate(
        true,
      ) as PeerCertificateWithChain;
      if (!cert) {
        finish({
          hostname: target.hostname,
          success: false,
          status: "error",
          validFrom: null,
          validUntil: null,
          daysRemaining: null,
          issuer: null,
          subject: null,
          dnsNames: [],
          tlsVersion: null,
          chainValid: null,
          chainInfo: null,
          errorCode: "CERTIFICATE_ERROR",
          errorMessage: "Peer did not provide a certificate",
          latencyMs: 0,
        });
        currentSocket.destroy();
        return;
      }

      const validFrom = cert.valid_from
        ? new Date(cert.valid_from).toISOString()
        : null;
      const validUntil = cert.valid_to
        ? new Date(cert.valid_to).toISOString()
        : null;
      const days = validUntil ? daysRemaining(validUntil) : null;
      const hostnameError = tls.checkServerIdentity(target.hostname, cert);
      const expired =
        !!validUntil && new Date(validUntil).getTime() <= Date.now();
      const chainValid = currentSocket.authorized;
      let success =
        Boolean(cert.subject) &&
        Boolean(chainValid) &&
        !hostnameError &&
        !expired;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;

      if (!cert.subject) {
        success = false;
        errorCode = "CERTIFICATE_ERROR";
        errorMessage = "Peer did not provide a certificate";
      } else if (hostnameError) {
        success = false;
        errorCode = "HOSTNAME_MISMATCH";
        errorMessage = "Certificate hostname does not match";
      } else if (expired) {
        success = false;
        errorCode = "CERT_EXPIRED";
        errorMessage = "Certificate is expired";
      } else if (!chainValid) {
        success = false;
        const authorizationError = currentSocket.authorizationError;
        [errorCode, errorMessage] = classifyError({
          code: authorizationError ?? "CERTIFICATE_ERROR",
        });
      }

      finish({
        hostname: target.hostname,
        success,
        status: success
          ? days !== null && days <= 30
            ? "expiring"
            : "valid"
          : expired
            ? "expired"
            : "error",
        validFrom,
        validUntil,
        daysRemaining: days,
        issuer: normalizeCertificateName(cert.issuer),
        subject: normalizeCertificateName(cert.subject),
        dnsNames: names(cert),
        tlsVersion: currentSocket.getProtocol() || null,
        chainValid,
        chainInfo: chainInfo(cert),
        errorCode,
        errorMessage,
        latencyMs: 0,
      });
      currentSocket.end();
    });

    socket.once("timeout", () => {
      clearTimeout(timer);
      socket?.destroy();
      finish({
        hostname: target.hostname,
        success: false,
        status: "error",
        validFrom: null,
        validUntil: null,
        daysRemaining: null,
        issuer: null,
        subject: null,
        dnsNames: [],
        tlsVersion: null,
        chainValid: null,
        chainInfo: null,
        errorCode: "TIMEOUT",
        errorMessage: "TLS connection timed out",
        latencyMs: 0,
      });
    });

    socket.once("error", (error: Error) => {
      clearTimeout(timer);
      const [code, message] = classifyError(error);
      socket?.destroy();
      finish({
        hostname: target.hostname,
        success: false,
        status: "error",
        validFrom: null,
        validUntil: null,
        daysRemaining: null,
        issuer: null,
        subject: null,
        dnsNames: [],
        tlsVersion: null,
        chainValid: null,
        chainInfo: null,
        errorCode: code,
        errorMessage: message,
        latencyMs: 0,
      });
    });
  });
}
