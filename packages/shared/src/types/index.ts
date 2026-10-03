export type DomainStatus =
  "unknown" | "valid" | "expiring" | "expired" | "error";
export type SslCheckStatus = "valid" | "expiring" | "expired" | "error";
export interface CertificateSnapshot {
  validFrom: string | null;
  validUntil: string | null;
  daysRemaining: number | null;
  issuer: string | null;
  subject: string | null;
  dnsNames: string[];
  tlsVersion: string | null;
  chainValid: boolean | null;
  chainInfo: unknown;
}
export interface SslCheckResult extends CertificateSnapshot {
  hostname: string;
  success: boolean;
  status: SslCheckStatus;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
}
