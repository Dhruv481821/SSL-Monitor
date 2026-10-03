import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import * as mcpKeys from "../../../packages/domain/src/mcp/service.js";

const rl = createInterface({ input, output });

try {
  const userId = (await rl.question("User ID: ")).trim();
  const keyId = (await rl.question("MCP key ID: ")).trim();

  if (!userId || !keyId) {
    throw new Error("User ID and MCP key ID are required");
  }

  const revoked = await mcpKeys.revoke(userId, keyId);

  if (!revoked) {
    throw new Error("MCP API key not found");
  }

  console.log("MCP API key revoked.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to revoke MCP API key",
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
