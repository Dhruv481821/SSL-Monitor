import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import * as mcpKeys from "../../../packages/domain/src/mcp/service.js";

const rl = createInterface({ input, output });

try {
  const userId = (await rl.question("User ID: ")).trim();
  const name = (await rl.question("API key name: ")).trim();

  if (!userId || !name) {
    throw new Error("User ID and API key name are required");
  }

  const result = await mcpKeys.create(userId, name);

  console.log("\nMCP API key created.");
  console.log(`ID: ${result.id}`);
  console.log(`Name: ${result.name}`);
  console.log(`Key: ${result.key}`);
  console.log("\nStore this key securely. It will not be shown again.\n");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to create MCP API key",
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
