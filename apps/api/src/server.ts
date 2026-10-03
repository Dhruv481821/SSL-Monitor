import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { getConfig } from "../../../packages/config/src/index.js";
import {
  AppError,
  alertQuerySchema,
  authSchema,
  domainParamsSchema,
  historyQuerySchema,
  hostnameSchema,
  monitoringToggleSchema,
  notificationSettingsSchema,
  UnauthorizedError,
} from "../../../packages/shared/src/index.js";
import {
  login,
  register,
  verifyToken,
} from "../../../packages/domain/src/auth/service.js";
import * as alerts from "../../../packages/domain/src/alerts/service.js";
import * as domains from "../../../packages/domain/src/domains/service.js";
import * as notifications from "../../../packages/domain/src/notifications/service.js";

const config = getConfig();
const app = Fastify({ logger: true });
await app.register(cors, { origin: config.CORS_ORIGIN });

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

type DomainParams = { domainId: string };

const buckets = new Map<string, { start: number; count: number }>();
function limit(key: string, max: number): boolean {
  const now = Date.now();
  const old = buckets.get(key);
  if (!old || now - old.start >= 60000) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  if (old.count >= max) return false;
  old.count++;
  return true;
}

async function auth(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new UnauthorizedError();
  try {
    request.user = verifyToken(header.slice(7));
  } catch {
    throw new UnauthorizedError("Invalid authentication token");
  }
}

function publicDomain(domain: {
  id: string;
  hostname: string;
  status: string;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
}) {
  return {
    id: domain.id,
    hostname: domain.hostname,
    status: domain.status,
    monitoringEnabled: domain.monitoring_enabled,
    lastCheckedAt: domain.last_checked_at,
    nextCheckAt: domain.next_check_at,
    lastSuccessAt: domain.last_success_at,
    consecutiveFailures: domain.consecutive_failures,
  };
}

function requestId(request: FastifyRequest): string {
  return request.id;
}

app.addHook("onRequest", async (request, reply) => {
  if (
    !request.url.startsWith("/api/v1/auth") &&
    !request.url.startsWith("/api/v1/health") &&
    !limit(`api:${request.ip}`, config.API_RATE_LIMIT_PER_MINUTE)
  ) {
    return reply.code(429).send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId: request.id,
      },
    });
  }

  if (
    request.method === "POST" ||
    request.method === "PUT" ||
    request.method === "PATCH"
  ) {
    const contentLength = request.headers["content-length"];
    const transferEncoding = request.headers["transfer-encoding"];
    const hasBody =
      (typeof contentLength === "string" &&
        Number.parseInt(contentLength, 10) > 0) ||
      (typeof transferEncoding === "string" &&
        transferEncoding.trim().length > 0);

    if (hasBody) {
      const contentType = request.headers["content-type"];
      const mediaType =
        typeof contentType === "string"
          ? contentType.split(";", 1)[0].trim().toLowerCase()
          : undefined;
      if (mediaType !== "application/json") {
        return reply.code(415).send({
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Content-Type must be application/json",
            requestId: request.id,
          },
        });
      }
    }
  }
});

app.setErrorHandler((err, request, reply) => {
  const id = request.id;
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String(err.code)
      : null;

  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        requestId: id,
      },
    });
  }
  if (err instanceof AppError) {
    return reply
      .code(err.statusCode)
      .send({ error: { code: err.code, message: err.message, requestId: id } });
  }
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return reply.code(415).send({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json",
        requestId: id,
      },
    });
  }
  if (code === "FST_ERR_CTP_INVALID_JSON_BODY") {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        requestId: id,
      },
    });
  }
  if (code === "23505") {
    return reply.code(409).send({
      error: {
        code: "CONFLICT",
        message: "Resource already exists",
        requestId: id,
      },
    });
  }

  request.log.error({ err, requestId: id }, "request failed");
  return reply.code(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId: id,
    },
  });
});

app.get("/api/v1/health", async () => ({ status: "ok" }));

app.post("/api/v1/auth/register", async (request, reply) => {
  if (!limit(`reg:${request.ip}`, config.LOGIN_RATE_LIMIT_PER_MINUTE)) {
    return reply.code(429).send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId: request.id,
      },
    });
  }
  const body = authSchema.parse(request.body);
  return reply.code(201).send(await register(body.email, body.password));
});

app.post("/api/v1/auth/login", async (request, reply) => {
  if (!limit(`login:${request.ip}`, config.LOGIN_RATE_LIMIT_PER_MINUTE)) {
    return reply.code(429).send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId: request.id,
      },
    });
  }
  const body = authSchema.parse(request.body);
  return reply.send(await login(body.email, body.password));
});

app.post("/api/v1/domains", { preHandler: auth }, async (request, reply) => {
  if (!limit(`add:${request.user!.id}:${request.ip}`, 20)) {
    return reply.code(429).send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        requestId: request.id,
      },
    });
  }
  const body = hostnameSchema.parse(request.body);
  const domain = await domains.add(request.user!.id, body.hostname);
  return reply.code(201).send(publicDomain(domain));
});

app.get("/api/v1/domains", { preHandler: auth }, async (request) => {
  return { domains: (await domains.list(request.user!.id)).map(publicDomain) };
});

app.get<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId",
  { preHandler: auth },
  async (request) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    return publicDomain(await domains.get(request.user!.id, domainId));
  },
);

app.delete<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId",
  { preHandler: auth },
  async (request, reply) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    await domains.remove(request.user!.id, domainId);
    return reply.code(204).send();
  },
);

app.patch<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId/monitoring",
  { preHandler: auth },
  async (request) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    const body = monitoringToggleSchema.parse(request.body);
    return publicDomain(
      await domains.setMonitoring(request.user!.id, domainId, body.enabled),
    );
  },
);

app.post<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId/check",
  { preHandler: auth },
  async (request, reply) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    if (
      !limit(
        `check:${request.user!.id}:${request.ip}`,
        config.MANUAL_CHECK_RATE_LIMIT_PER_MINUTE,
      )
    ) {
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many manual checks",
          requestId: request.id,
        },
      });
    }
    return reply.send(await domains.check(request.user!.id, domainId));
  },
);

app.get<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId/ssl",
  { preHandler: auth },
  async (request) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    const result = await domains.current(request.user!.id, domainId);
    return result ?? { status: "unknown" };
  },
);

app.get<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId/certificate",
  { preHandler: auth },
  async (request) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    return domains.certificate(request.user!.id, domainId);
  },
);

app.get<{ Params: DomainParams }>(
  "/api/v1/domains/:domainId/history",
  { preHandler: auth },
  async (request) => {
    const { domainId } = domainParamsSchema.parse(request.params);
    const q = historyQuerySchema.parse(request.query);
    return {
      items: await domains.history(
        request.user!.id,
        domainId,
        q.limit,
        q.cursor,
      ),
    };
  },
);

app.get("/api/v1/alerts", { preHandler: auth }, async (request) => {
  const q = alertQuerySchema.parse(request.query);
  return { items: await alerts.list(request.user!.id, q.state, q.limit) };
});

app.get(
  "/api/v1/notification-settings",
  { preHandler: auth },
  async (request) => {
    return notifications.get(request.user!.id);
  },
);

app.put(
  "/api/v1/notification-settings",
  { preHandler: auth },
  async (request) => {
    const body = notificationSettingsSchema.parse(request.body);
    return notifications.update(request.user!.id, body);
  },
);

if (process.env.NODE_ENV !== "test") {
  app
    .listen({ host: config.HOST, port: config.PORT })
    .then(() =>
      app.log.info(
        `SSL Monitor API listening on ${config.HOST}:${config.PORT}`,
      ),
    );
}

export { app };
