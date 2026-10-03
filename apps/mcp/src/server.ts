import { createServer, type ServerResponse } from "node:http";

import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";

import { getConfig } from "../../../packages/config/src/index.js";
import { AppError } from "../../../packages/shared/src/index.js";
import * as domains from "../../../packages/domain/src/domains/service.js";
import { authenticateRequest } from "./auth.js";

const MCP_HOST = process.env.MCP_HOST ?? "127.0.0.1";
const MCP_PORT = Number(process.env.MCP_PORT ?? 3001);

const MCP_SERVER_NAME = "ssl-monitor";
const MCP_SERVER_VERSION = "0.1.0";

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;

const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 3650;

const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitBucket {
  windowStart: number;
  count: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function getMcpRateLimit(): number {
  return getConfig().MCP_RATE_LIMIT_PER_MINUTE;
}

function checkRateLimit(keyId: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const current = rateLimitBuckets.get(keyId);

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(keyId, {
      windowStart: now,
      count: 1,
    });

    return {
      allowed: true,
      retryAfterSeconds: 60,
    };
  }

  if (current.count >= getMcpRateLimit()) {
    const elapsed = now - current.windowStart;
    const remainingMs = Math.max(0, RATE_LIMIT_WINDOW_MS - elapsed);

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  current.count++;

  return {
    allowed: true,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(
        Math.max(0, RATE_LIMIT_WINDOW_MS - (now - current.windowStart)) / 1000,
      ),
    ),
  };
}

function cleanupRateLimitBuckets(): void {
  const now = Date.now();

  for (const [keyId, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(keyId);
    }
  }
}

const rateLimitCleanupTimer = setInterval(
  cleanupRateLimitBuckets,
  RATE_LIMIT_WINDOW_MS,
);

rateLimitCleanupTimer.unref();

type AuthenticatedRequest = Parameters<ReturnType<typeof toNodeHandler>>[0] & {
  auth?: AuthInfo;
};

function textResult(text: string, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(error: unknown, fallback: string) {
  if (!(error instanceof AppError)) {
    return textResult(fallback, true);
  }

  switch (error.code) {
    case "VALIDATION_ERROR":
      return textResult("Invalid request.", true);

    case "UNAUTHORIZED":
      return textResult("Authentication required.", true);

    case "FORBIDDEN":
      return textResult("Access denied.", true);

    case "NOT_FOUND":
      return textResult("Resource not found.", true);

    case "CONFLICT":
      return textResult("Resource conflict.", true);

    case "UNSAFE_TARGET":
      return textResult("Target is not allowed.", true);

    default:
      return textResult(fallback, true);
  }
}

function createServerInstance(ctx: { authInfo?: AuthInfo }) {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ---------------------------------------------------------------------------
  // 1. add_domain
  // ---------------------------------------------------------------------------

  server.registerTool(
    "add_domain",
    {
      description:
        "Add a domain to the authenticated user's SSL Monitor account.",
      inputSchema: {
        domain: z
          .string()
          .trim()
          .min(1)
          .max(253)
          .describe("Hostname to monitor, for example example.com"),
      },
    },
    async ({ domain }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const created = await domains.add(userId, domain);

        return jsonResult({
          id: created.id,
          hostname: created.hostname,
          status: created.status,
          monitoringEnabled: created.monitoring_enabled,
          lastCheckedAt: created.last_checked_at,
          nextCheckAt: created.next_check_at,
          lastSuccessAt: created.last_success_at,
          consecutiveFailures: created.consecutive_failures,
        });
      } catch (error) {
        return errorResult(error, "Unable to add domain.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 2. remove_domain
  // ---------------------------------------------------------------------------

  server.registerTool(
    "remove_domain",
    {
      description:
        "Remove a domain from the authenticated user's SSL Monitor account.",
      inputSchema: {
        domainId: z.string().uuid().describe("UUID of the domain to remove"),
      },
    },
    async ({ domainId }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        await domains.remove(userId, domainId);

        return jsonResult({
          success: true,
          domainId,
          message: "Domain removed successfully.",
        });
      } catch (error) {
        return errorResult(error, "Unable to remove domain.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 3. get_domains
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_domains",
    {
      description:
        "List all domains belonging to the authenticated user's SSL Monitor account.",
      inputSchema: z.object({}),
    },
    async (_args) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const domainList = await domains.list(userId);

        const result = domainList.map((domain) => ({
          id: domain.id,
          hostname: domain.hostname,
          status: domain.status,
          monitoringEnabled: domain.monitoring_enabled,
          lastCheckedAt: domain.last_checked_at,
          nextCheckAt: domain.next_check_at,
          lastSuccessAt: domain.last_success_at,
          consecutiveFailures: domain.consecutive_failures,
          createdAt: domain.created_at,
        }));

        return jsonResult({
          count: result.length,
          domains: result,
        });
      } catch (error) {
        return errorResult(error, "Unable to retrieve domains.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 4. get_ssl_status
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_ssl_status",
    {
      description:
        "Get the latest SSL/TLS status for a domain belonging to the authenticated user.",
      inputSchema: {
        domainId: z.string().uuid().describe("UUID of the domain"),
      },
    },
    async ({ domainId }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const status = await domains.current(userId, domainId);

        if (!status) {
          return jsonResult({
            domainId,
            status: "unknown",
            message: "No SSL check has been recorded for this domain yet.",
          });
        }

        return jsonResult({
          id: status.id,
          hostname: status.hostname,
          success: status.success,
          status: status.status,
          checkedAt: status.checked_at,
          validFrom: status.validFrom,
          validUntil: status.validUntil,
          daysRemaining: status.daysRemaining,
          issuer: status.issuer,
          subject: status.subject,
          dnsNames: status.dnsNames,
          tlsVersion: status.tlsVersion,
          chainValid: status.chainValid,
          latencyMs: status.latencyMs,
          errorCode: status.errorCode,
          errorMessage: status.errorMessage,
        });
      } catch (error) {
        return errorResult(error, "Unable to retrieve SSL status.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 5. get_certificate_details
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_certificate_details",
    {
      description:
        "Get certificate details from the latest successful SSL check for an authenticated user's domain.",
      inputSchema: {
        domainId: z.string().uuid().describe("UUID of the domain"),
      },
    },
    async ({ domainId }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const certificate = await domains.certificate(userId, domainId);

        if (!certificate) {
          return jsonResult({
            domainId,
            certificate: null,
            message:
              "No successful SSL certificate snapshot is available for this domain.",
          });
        }

        return jsonResult({
          domainId,
          certificate: {
            validFrom: certificate.validFrom,
            validUntil: certificate.validUntil,
            daysRemaining: certificate.daysRemaining,
            issuer: certificate.issuer,
            subject: certificate.subject,
            dnsNames: certificate.dnsNames,
            tlsVersion: certificate.tlsVersion,
            chainValid: certificate.chainValid,
            chainInfo: certificate.chainInfo,
          },
        });
      } catch (error) {
        return errorResult(error, "Unable to retrieve certificate details.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 6. check_domain_now
  // ---------------------------------------------------------------------------

  server.registerTool(
    "check_domain_now",
    {
      description:
        "Immediately perform an SSL/TLS check for an authenticated user's domain using the existing SSL monitoring engine.",
      inputSchema: {
        domainId: z.string().uuid().describe("UUID of the domain to check"),
      },
    },
    async ({ domainId }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const result = await domains.check(userId, domainId);

        return jsonResult({
          id: result.id,
          hostname: result.hostname,
          success: result.success,
          status: result.status,
          checkedAt: result.checkedAt,
          validFrom: result.validFrom,
          validUntil: result.validUntil,
          daysRemaining: result.daysRemaining,
          issuer: result.issuer,
          subject: result.subject,
          dnsNames: result.dnsNames,
          tlsVersion: result.tlsVersion,
          chainValid: result.chainValid,
          chainInfo: result.chainInfo,
          latencyMs: result.latencyMs,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        });
      } catch (error) {
        return errorResult(error, "Unable to check domain.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 7. list_expiring_certificates
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_expiring_certificates",
    {
      description:
        "List certificates belonging to the authenticated user that are expiring within the specified number of days.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(0)
          .max(MAX_EXPIRY_DAYS)
          .default(DEFAULT_EXPIRY_DAYS)
          .describe("Number of days ahead to search, default 30"),
      },
    },
    async ({ days }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const certificates = await domains.listExpiring(userId, days);

        return jsonResult({
          days,
          count: certificates.length,
          certificates,
        });
      } catch (error) {
        return errorResult(error, "Unable to list expiring certificates.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 8. list_ssl_errors
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_ssl_errors",
    {
      description:
        "List domains belonging to the authenticated user that currently have SSL/TLS errors or expired certificates.",
      inputSchema: z.object({}),
    },
    async (_args) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const errors = await domains.listSslErrors(userId);

        return jsonResult({
          count: errors.length,
          errors,
        });
      } catch (error) {
        return errorResult(error, "Unable to list SSL errors.");
      }
    },
  );

  // ---------------------------------------------------------------------------
  // 9. get_monitoring_history
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_monitoring_history",
    {
      description:
        "Get historical SSL monitoring checks for an authenticated user's domain.",
      inputSchema: {
        domainId: z.string().uuid().describe("UUID of the domain"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_HISTORY_LIMIT)
          .default(DEFAULT_HISTORY_LIMIT)
          .describe("Maximum number of history records to return"),
        cursor: z
          .string()
          .datetime()
          .optional()
          .describe("Optional ISO timestamp cursor for pagination"),
      },
    },
    async ({ domainId, limit, cursor }) => {
      const userId = ctx.authInfo?.clientId;

      if (!userId) {
        return textResult("Authentication context is missing.", true);
      }

      try {
        const history = await domains.history(userId, domainId, limit, cursor);

        return jsonResult({
          domainId,
          count: history.length,
          items: history,
        });
      } catch (error) {
        return errorResult(error, "Unable to retrieve monitoring history.");
      }
    },
  );

  return server;
}

const handler = createMcpHandler(createServerInstance);
const nodeHandler = toNodeHandler(handler);

export async function handleMcpRequest(
  req: AuthenticatedRequest,
  res: ServerResponse,
): Promise<void> {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        error: "Not Found",
      }),
    );

    return;
  }

  try {
    const requestUrl = `http://${req.headers.host ?? `${MCP_HOST}:${MCP_PORT}`}${req.url}`;

    const webRequest = new Request(requestUrl, {
      method: req.method ?? "GET",
      headers: new Headers(
        Object.entries(req.headers).flatMap(([key, value]) => {
          if (Array.isArray(value)) {
            return value.map((item) => [key, item] as [string, string]);
          }

          if (value === undefined) {
            return [];
          }

          return [[key, value] as [string, string]];
        }),
      ),
    });

    const authContext = await authenticateRequest(webRequest);

    const rateLimit = checkRateLimit(authContext.apiKeyId);

    if (!rateLimit.allowed) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": String(rateLimit.retryAfterSeconds),
      });

      res.end(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        }),
      );

      return;
    }

    const authInfo: AuthInfo = {
      token:
        typeof req.headers.authorization === "string"
          ? req.headers.authorization.replace(/^Bearer\s+/i, "").trim()
          : "",
      clientId: authContext.userId,
      scopes: ["mcp"],
    };

    req.auth = authInfo;

    await nodeHandler(req, res);
  } catch (error) {
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode) || 401
        : 401;

    res.writeHead(statusCode, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        error: "Unauthorized",
      }),
    );
  }
}

export function createMcpHttpServer() {
  return createServer(async (req, res) => {
    await handleMcpRequest(req as AuthenticatedRequest, res);
  });
}

export function startMcpServer() {
  const httpServer = createMcpHttpServer();

  httpServer.listen(MCP_PORT, MCP_HOST, () => {
    console.log(
      `SSL Monitor MCP server listening on http://${MCP_HOST}:${MCP_PORT}/mcp`,
    );
  });

  return httpServer;
}

async function shutdown(
  signal: string,
  httpServer: ReturnType<typeof createMcpHttpServer>,
) {
  console.log(`Received ${signal}. Shutting down MCP server...`);

  clearInterval(rateLimitCleanupTimer);

  await handler.close();

  httpServer.close((error) => {
    if (error) {
      console.error("MCP server shutdown failed:", error);
      process.exitCode = 1;
      return;
    }

    console.log("MCP server stopped.");
  });
}

const isMainModule =
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(
    process.argv[1].replaceAll("\\", "/"),
  );

if (isMainModule) {
  const httpServer = startMcpServer();

  process.once("SIGINT", () => {
    void shutdown("SIGINT", httpServer);
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", httpServer);
  });
}
