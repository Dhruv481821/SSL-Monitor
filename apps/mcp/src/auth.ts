import { UnauthorizedError } from "../../../packages/shared/src/index.js";

import { authenticate } from "../../../packages/domain/src/mcp/service.js";

export interface McpAuthContext {
  apiKeyId: string;
  userId: string;
  keyName: string;
}

function extractApiKey(request: Request): string {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    throw new UnauthorizedError("MCP API key required");
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());

  if (!match?.[1]) {
    throw new UnauthorizedError("Invalid MCP authorization header");
  }

  return match[1].trim();
}

export async function authenticateRequest(
  request: Request,
): Promise<McpAuthContext> {
  const apiKey = extractApiKey(request);
  const authenticated = await authenticate(apiKey);

  return {
    apiKeyId: authenticated.id,
    userId: authenticated.userId,
    keyName: authenticated.name,
  };
}
