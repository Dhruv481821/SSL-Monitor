import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("MCP server integration", () => {
  let pool: typeof import("../../packages/db/src/client.js").pool;
  let query: typeof import("../../packages/db/src/client.js").query;
  let createMcpHttpServer: typeof import("../../apps/mcp/src/server.js").createMcpHttpServer;
  let mcpKeys: typeof import("../../packages/domain/src/mcp/service.js").create;

  let userA: string;
  let userB: string;

  let keyA: string;
  let keyB: string;
  let rateLimitKey: string;

  let keyAId: string;
  let keyBId: string;

  let domainA: string;
  let domainB: string;

  let httpServer: ReturnType<
    typeof import("../../apps/mcp/src/server.js").createMcpHttpServer
  >;

  let baseUrl: string;

  async function mcpRequest(
    body: unknown,
    options: {
      key?: string;
      sessionId?: string;
      method?: "POST" | "GET" | "DELETE";
    } = {},
  ) {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
    };

    if (options.key) {
      headers.Authorization = `Bearer ${options.key}`;
    }

    if (options.sessionId) {
      headers["Mcp-Session-Id"] = options.sessionId;
    }

    if (options.method !== "GET" && options.method !== "DELETE") {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}/mcp`, {
      method: options.method ?? "POST",
      headers,
      body:
        options.method === "GET" || options.method === "DELETE"
          ? undefined
          : JSON.stringify(body),
    });

    const text = await response.text();

    return {
      response,
      text,
      sessionId: response.headers.get("mcp-session-id"),
    };
  }

  function parseJsonRpc(text: string): unknown {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    if (dataLines.length > 0) {
      return JSON.parse(dataLines[dataLines.length - 1]);
    }

    return JSON.parse(text);
  }

  async function initialize(key: string) {
    const result = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "ssl-monitor-vitest",
            version: "1.0.0",
          },
        },
      },
      { key },
    );

    expect(result.response.status).toBe(200);

    return {
      ...result,
      rpc: parseJsonRpc(result.text) as {
        result?: {
          serverInfo?: {
            name?: string;
            version?: string;
          };
        };
      },
    };
  }

  async function callTool(
    key: string,
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
    id = 2,
  ) {
    return mcpRequest(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      },
      {
        key,
        sessionId,
      },
    );
  }

  beforeAll(async () => {
    const db = await import("../../packages/db/src/client.js");
    const server = await import("../../apps/mcp/src/server.js");
    const keyService = await import("../../packages/domain/src/mcp/service.js");

    pool = db.pool;
    query = db.query;
    createMcpHttpServer = server.createMcpHttpServer;
    mcpKeys = keyService.create;

    const timestamp = Date.now();

    const userAResult = await query<{ id: string }>(
      `INSERT INTO users(email,password_hash)
       VALUES($1,$2)
       RETURNING id`,
      [`phase09-mcp-a-${timestamp}@example.com`, "test-hash"],
    );

    const userBResult = await query<{ id: string }>(
      `INSERT INTO users(email,password_hash)
       VALUES($1,$2)
       RETURNING id`,
      [`phase09-mcp-b-${timestamp}@example.com`, "test-hash"],
    );

    userA = userAResult.rows[0].id;
    userB = userBResult.rows[0].id;

    const createdKeyA = await mcpKeys(userA, `phase09-test-a-${timestamp}`);

    const createdKeyB = await mcpKeys(userB, `phase09-test-b-${timestamp}`);

    const createdRateLimitKey = await mcpKeys(
      userA,
      `phase09-rate-limit-${timestamp}`,
    );

    keyA = createdKeyA.key;
    keyB = createdKeyB.key;
    rateLimitKey = createdRateLimitKey.key;

    keyAId = createdKeyA.id;
    keyBId = createdKeyB.id;

    const domainAResult = await query<{ id: string }>(
      `INSERT INTO domains(user_id,hostname)
       VALUES($1,$2)
       RETURNING id`,
      [userA, `phase09-a-${timestamp}.example.com`],
    );

    const domainBResult = await query<{ id: string }>(
      `INSERT INTO domains(user_id,hostname)
       VALUES($1,$2)
       RETURNING id`,
      [userB, `phase09-b-${timestamp}.example.com`],
    );

    domainA = domainAResult.rows[0].id;
    domainB = domainBResult.rows[0].id;

    httpServer = createMcpHttpServer();

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
      httpServer.once("error", reject);
    });

    const address = httpServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve MCP test server address");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    if (userA) {
      await query("DELETE FROM users WHERE id=$1", [userA]);
    }

    if (userB) {
      await query("DELETE FROM users WHERE id=$1", [userB]);
    }

    if (pool) {
      await pool.end();
    }
  });

  it("rejects requests without an MCP API key", async () => {
    const result = await mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "unauthenticated-test",
          version: "1.0.0",
        },
      },
    });

    expect(result.response.status).toBe(401);
    expect(result.text).toContain("Unauthorized");
  });

  it("rejects an invalid MCP API key", async () => {
    const result = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "invalid-key-test",
            version: "1.0.0",
          },
        },
      },
      {
        key: "smcp_invalid-test-key",
      },
    );

    expect(result.response.status).toBe(401);
    expect(result.text).toContain("Unauthorized");
  });

  it("accepts a valid MCP API key and initializes the protocol", async () => {
    const result = await initialize(keyA);

    expect(result.rpc.result?.serverInfo?.name).toBe("ssl-monitor");
    expect(result.rpc.result?.serverInfo?.version).toBe("0.1.0");
  });

  it("lists all nine required MCP tools", async () => {
    const initialized = await initialize(keyA);
    const sessionId = initialized.sessionId!;

    const result = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      {
        key: keyA,
        sessionId,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        tools?: Array<{
          name: string;
        }>;
      };
    };

    const names = rpc.result?.tools?.map((tool) => tool.name) ?? [];

    expect(names).toEqual(
      expect.arrayContaining([
        "add_domain",
        "remove_domain",
        "get_domains",
        "get_ssl_status",
        "get_certificate_details",
        "check_domain_now",
        "list_expiring_certificates",
        "list_ssl_errors",
        "get_monitoring_history",
      ]),
    );

    expect(names).toHaveLength(9);
  });

  it("get_domains returns only the authenticated user's domains", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "get_domains",
      {},
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    const content = rpc.result?.content?.[0]?.text ?? "";

    const payload = JSON.parse(content) as {
      count: number;
      domains: Array<{
        id: string;
      }>;
    };

    expect(payload.count).toBe(1);
    expect(payload.domains[0].id).toBe(domainA);
    expect(content).not.toContain(domainB);
  });

  it("prevents cross-user SSL status access", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "get_ssl_status",
      {
        domainId: domainB,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);

    const text = rpc.result?.content?.[0]?.text ?? "";

    expect(text).toBe("Resource not found.");
    expect(text).not.toContain(domainB);
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("postgres");
  });

  it("prevents cross-user domain deletion", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "remove_domain",
      {
        domainId: domainB,
      },
    );

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBe("Resource not found.");

    const check = await query<{ id: string }>(
      "SELECT id FROM domains WHERE id=$1 AND user_id=$2",
      [domainB, userB],
    );

    expect(check.rows).toHaveLength(1);
  });

  it("rejects invalid UUID input through MCP schema validation", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "get_ssl_status",
      {
        domainId: "not-a-uuid",
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBeTruthy();

    expect(result.text).not.toContain("password_hash");
    expect(result.text).not.toContain("DATABASE_URL");
    expect(result.text).not.toContain("postgres://");
  });

  it("rejects an invalid expiry-day range", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "list_expiring_certificates",
      {
        days: 3651,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBeTruthy();

    expect(result.text).not.toContain("password_hash");
    expect(result.text).not.toContain("DATABASE_URL");
    expect(result.text).not.toContain("postgres://");
  });

  it("rejects an invalid monitoring history limit", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "get_monitoring_history",
      {
        domainId: domainA,
        limit: 101,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBeTruthy();

    expect(result.text).not.toContain("password_hash");
    expect(result.text).not.toContain("DATABASE_URL");
    expect(result.text).not.toContain("postgres://");
  });

  it("blocks localhost SSRF targets through the existing domain service", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(keyA, initialized.sessionId!, "add_domain", {
      domain: "127.0.0.1",
    });

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBe("Target is not allowed.");
  });

  it("blocks private IPv4 SSRF targets through the existing domain service", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(keyA, initialized.sessionId!, "add_domain", {
      domain: "10.0.0.1",
    });

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBe("Target is not allowed.");
  });

  it("get_certificate_details returns a safe not-found response", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "get_certificate_details",
      {
        domainId: "00000000-0000-0000-0000-000000000000",
      },
    );

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBe("Resource not found.");
  });

  it("check_domain_now enforces ownership before running the SSL engine", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "check_domain_now",
      {
        domainId: domainB,
      },
    );

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        isError?: boolean;
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.isError).toBe(true);
    expect(rpc.result?.content?.[0]?.text).toBe("Resource not found.");
  });

  it("list_expiring_certificates returns a structured response", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "list_expiring_certificates",
      {
        days: 30,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    expect(rpc.result?.content?.[0]?.type).toBe("text");

    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      days: number;
      count: number;
      certificates: unknown[];
    };

    expect(payload.days).toBe(30);
    expect(payload.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(payload.certificates)).toBe(true);
  });

  it("list_ssl_errors returns a structured response", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "list_ssl_errors",
      {},
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      count: number;
      errors: unknown[];
    };

    expect(typeof payload.count).toBe("number");
    expect(Array.isArray(payload.errors)).toBe(true);
  });

  it("get_monitoring_history returns a structured response", async () => {
    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "get_monitoring_history",
      {
        domainId: domainA,
        limit: 20,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      domainId: string;
      count: number;
      items: unknown[];
    };

    expect(payload.domainId).toBe(domainA);
    expect(typeof payload.count).toBe("number");
    expect(Array.isArray(payload.items)).toBe(true);
  });

  it("remove_domain successfully removes the authenticated user's domain", async () => {
    const temporaryDomain = await query<{ id: string }>(
      `INSERT INTO domains(user_id,hostname)
       VALUES($1,$2)
       RETURNING id`,
      [userA, `phase09-remove-${Date.now()}.example.com`],
    );

    const initialized = await initialize(keyA);

    const result = await callTool(
      keyA,
      initialized.sessionId!,
      "remove_domain",
      {
        domainId: temporaryDomain.rows[0].id,
      },
    );

    expect(result.response.status).toBe(200);

    const rpc = parseJsonRpc(result.text) as {
      result?: {
        content?: Array<{
          type: string;
          text: string;
        }>;
      };
    };

    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      success: boolean;
      domainId: string;
    };

    expect(payload.success).toBe(true);
    expect(payload.domainId).toBe(temporaryDomain.rows[0].id);

    const check = await query<{ id: string }>(
      "SELECT id FROM domains WHERE id=$1",
      [temporaryDomain.rows[0].id],
    );

    expect(check.rows).toHaveLength(0);
  });

  it("enforces the MCP API rate limit", async () => {
    let lastResult: Awaited<ReturnType<typeof mcpRequest>> | undefined;

    for (let index = 0; index < 61; index += 1) {
      lastResult = await mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1000 + index,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: {
              name: "rate-limit-test",
              version: "1.0.0",
            },
          },
        },
        {
          key: rateLimitKey,
        },
      );
    }

    expect(lastResult?.response.status).toBe(429);
    expect(lastResult?.response.headers.get("retry-after")).toBeTruthy();
    expect(lastResult?.text).toContain("Rate limit exceeded");
  }, 30_000);

  it("rejects a revoked MCP key", async () => {
    const initialized = await initialize(keyB);

    const revoked = await query(
      `UPDATE mcp_api_keys
       SET revoked_at=now()
       WHERE id=$1`,
      [keyBId],
    );

    expect(revoked.rowCount).toBe(1);

    const result = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 99,
        method: "tools/list",
        params: {},
      },
      {
        key: keyB,
        sessionId: initialized.sessionId!,
      },
    );

    expect(result.response.status).toBe(401);
    expect(result.text).toContain("Unauthorized");
  });

  it("does not expose the raw MCP API key in an error response", async () => {
    const result = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 100,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "secret-leak-test",
            version: "1.0.0",
          },
        },
      },
      {
        key: "smcp_secret-that-must-not-leak",
      },
    );

    expect(result.text).not.toContain("smcp_secret-that-must-not-leak");
    expect(result.text).not.toContain("password_hash");
    expect(result.text).not.toContain("postgres://");
    expect(result.text).not.toContain("DATABASE_URL");
  });
});
