import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import { UnsafeTargetError, UpstreamError } from "../../../shared/src/index.js";

type IPv4Range = readonly [base: string, bits: number];

// Conservative deny-list for addresses that must never become outbound monitoring targets.
const blockedIpv4: IPv4Range[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, octet) => (n * 256 + Number(octet)) >>> 0, 0);
}

function ipv4Blocked(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return blockedIpv4.some(([base, bits]) => {
    const network = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (network & mask);
  });
}

function expandIpv6(ip: string): number[] | null {
  const input = ip.toLowerCase();
  const zoneIndex = input.indexOf("%");
  const address = zoneIndex >= 0 ? input.slice(0, zoneIndex) : input;
  const parts = address.split(":");
  const emptyIndex = parts.indexOf("");

  if (emptyIndex >= 0) {
    if (parts.indexOf("", emptyIndex + 1) >= 0) return null;
    const left = parts.slice(0, emptyIndex);
    const right = parts.slice(emptyIndex + 1);
    const expanded: string[] = [...left];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    expanded.push(...Array.from({ length: missing }, () => "0"));
    expanded.push(...right);
    return expandIpv6Parts(expanded);
  }

  return expandIpv6Parts(parts);
}

function expandIpv6Parts(parts: string[]): number[] | null {
  const normalized = [...parts];
  const last = normalized.at(-1);
  if (last?.includes(".")) {
    if (net.isIP(last) !== 4 || normalized.length > 8) return null;
    const octets = last.split(".").map(Number);
    normalized.splice(
      -1,
      1,
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    );
  }
  if (normalized.length !== 8) return null;
  const result = normalized.map((part) => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return -1;
    return Number.parseInt(part, 16);
  });
  return result.some((part) => part < 0) ? null : result;
}

function ipv6ToIpv4(groups: number[]): string | null {
  const mapped =
    groups.slice(0, 6).every((group, index) => group === 0 && index < 5) &&
    groups[5] === 0xffff;
  if (!mapped) return null;
  const value = ((groups[6] << 16) | groups[7]) >>> 0;
  return `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function ipv6Blocked(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return true;

  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = groups;

  // Unspecified / loopback.
  if (
    groups.every((group) => group === 0) ||
    (groups.slice(0, 7).every((group) => group === 0) && eighth === 1)
  )
    return true;

  // IPv4-mapped IPv6. Apply the IPv4 policy to the embedded address.
  const mappedIpv4 = ipv6ToIpv4(groups);
  if (mappedIpv4) return ipv4Blocked(mappedIpv4);

  // Unique-local, link-local, multicast, site-local/deprecated local, documentation.
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  if (first === 0x2001 && second === 0x0db8) return true; // 2001:db8::/32

  // IPv4-compatible addresses (::/96) are deprecated and not valid public targets.
  if (
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0
  )
    return true;

  return false;
}

export function assertSafeAddress(address: string): void {
  const family = net.isIP(address);
  if (!family) throw new UnsafeTargetError("DNS returned an invalid address");
  if (family === 4 ? ipv4Blocked(address) : ipv6Blocked(address)) {
    throw new UnsafeTargetError("Target resolves to a blocked network address");
  }
}
export function assertAllAddressesSafe(addresses: readonly string[]): void {
  if (addresses.length === 0)
    throw new UpstreamError(
      "DNS_FAILURE",
      "DNS resolution returned no addresses",
    );
  for (const address of addresses) assertSafeAddress(address);
}

function normalizeHostname(input: string): string {
  const hostname = input.trim().toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname.includes("://") ||
    /[\\/@?#:]/.test(hostname) ||
    net.isIP(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new UnsafeTargetError("Hostname is not allowed");
  }

  if (
    !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      hostname,
    )
  ) {
    throw new UnsafeTargetError("Invalid hostname");
  }
  return hostname;
}

export interface SafeTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export async function resolveSafeTarget(
  input: string,
  timeoutMs: number,
): Promise<SafeTarget> {
  const hostname = normalizeHostname(input);
  try {
    const answers = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new UpstreamError("DNS_TIMEOUT", "DNS resolution timed out", 504),
            ),
          timeoutMs,
        );
      }),
    ]);

    if (!answers.length)
      throw new UpstreamError(
        "DNS_FAILURE",
        "DNS resolution returned no addresses",
      );

    // Every answer is inspected. If any answer is unsafe, reject the hostname rather than
    // selecting a safe-looking answer and leaving a rebinding/ambiguous-resolution gap.
    assertAllAddressesSafe(answers.map((answer) => answer.address));

    const selected =
      answers.find((answer) => answer.family === 4) ?? answers[0];
    return {
      hostname,
      address: selected.address,
      family: selected.family as 4 | 6,
    };
  } catch (error) {
    if (error instanceof UnsafeTargetError || error instanceof UpstreamError)
      throw error;
    throw new UpstreamError("DNS_FAILURE", "DNS resolution failed");
  }
}

export async function validateWebhookUrl(
  input: string,
  timeoutMs = 5000,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UnsafeTargetError("Webhook URL is invalid");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  ) {
    throw new UnsafeTargetError("Webhook URL must use HTTPS on port 443");
  }

  const hostname = normalizeHostname(url.hostname);
  await resolveSafeTarget(hostname, timeoutMs);
  url.hostname = hostname;
  return url.toString();
}

export { normalizeHostname };

export interface SafeWebhookResponse {
  statusCode: number;
}

export async function postSafeWebhook(
  input: string,
  payload: unknown,
  timeoutMs = 5000,
): Promise<SafeWebhookResponse> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UnsafeTargetError("Webhook URL is invalid");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  ) {
    throw new UnsafeTargetError("Webhook URL must use HTTPS on port 443");
  }

  const hostname = normalizeHostname(url.hostname);
  const target = await resolveSafeTarget(hostname, timeoutMs);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: target.address,
        port: 443,
        servername: target.hostname,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        },
        timeout: timeoutMs,
        rejectUnauthorized: true,
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Webhook returned HTTP ${statusCode}`));
            return;
          }
          resolve({ statusCode });
        });
      },
    );

    request.once("timeout", () => {
      request.destroy(new Error("Webhook request timed out"));
    });
    request.once("error", reject);
    request.end(body);
  });
}
