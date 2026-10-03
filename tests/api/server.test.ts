import { beforeAll, afterAll, describe, expect, it } from "vitest";

const TEST_SECRET = "phase04-test-secret-that-is-long-enough-123456";
const hasDatabase = Boolean(process.env.DATABASE_URL);

let app: typeof import("../../apps/api/src/server.js").app;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://invalid:invalid@127.0.0.1:5432/ssl_monitor_test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? TEST_SECRET;
  process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  process.env.API_RATE_LIMIT_PER_MINUTE =
    process.env.API_RATE_LIMIT_PER_MINUTE ?? "120";
  process.env.LOGIN_RATE_LIMIT_PER_MINUTE =
    process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? "10";
  process.env.MANUAL_CHECK_RATE_LIMIT_PER_MINUTE =
    process.env.MANUAL_CHECK_RATE_LIMIT_PER_MINUTE ?? "20";
  const module = await import("../../apps/api/src/server.js");
  app = module.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("REST API transport and security boundaries", () => {
  it("returns a public health response", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rejects protected routes without authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/domains",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects unsupported content types with 415", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "content-type": "text/plain" },
      payload: "email=user@example.com&password=123456789012",
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects malformed JSON with a validation error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: '{"email":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it.skipIf(!hasDatabase)(
    "allows bodyless POST /domains/:domainId/check without Content-Type to reach ownership checks",
    async () => {
      const suffix = Date.now();
      const password = "Phase04-Bodyless-Check-Test-123!";
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        headers: { "content-type": "application/json" },
        payload: { email: `bodyless-check-a-${suffix}@example.com`, password },
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        headers: { "content-type": "application/json" },
        payload: { email: `bodyless-check-b-${suffix}@example.com`, password },
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);

      const tokenA = first.json().token as string;
      const tokenB = second.json().token as string;
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/domains",
        headers: {
          authorization: `Bearer ${tokenA}`,
          "content-type": "application/json",
        },
        payload: { hostname: "example.com" },
      });
      expect(created.statusCode).toBe(201);

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/domains/${created.json().id as string}/check`,
        headers: { authorization: `Bearer ${tokenB}` },
      });

      expect([403, 404]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(415);
    },
  );

  it.skipIf(!hasDatabase)("enforces cross-user domain ownership", async () => {
    const suffix = Date.now();
    const password = "Phase04-Test-Password-123!";
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: { email: `phase04-a-${suffix}@example.com`, password },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: { email: `phase04-b-${suffix}@example.com`, password },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const tokenA = first.json().token as string;
    const tokenB = second.json().token as string;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/domains",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: { hostname: "example.com" },
    });
    expect(created.statusCode).toBe(201);
    const domainId = created.json().id as string;

    for (const request of [
      { method: "GET" as const, url: `/api/v1/domains/${domainId}` },
      { method: "GET" as const, url: `/api/v1/domains/${domainId}/ssl` },
      {
        method: "GET" as const,
        url: `/api/v1/domains/${domainId}/certificate`,
      },
      { method: "GET" as const, url: `/api/v1/domains/${domainId}/history` },
      { method: "POST" as const, url: `/api/v1/domains/${domainId}/check` },
      { method: "DELETE" as const, url: `/api/v1/domains/${domainId}` },
    ]) {
      const response = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect([403, 404]).toContain(response.statusCode);
    }

    const cleanup = await app.inject({
      method: "DELETE",
      url: `/api/v1/domains/${domainId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(cleanup.statusCode).toBe(204);
  });

  it("rejects invalid JWTs before accessing protected resources", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/domains",
      headers: { authorization: "Bearer invalid.jwt.token" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });
});
