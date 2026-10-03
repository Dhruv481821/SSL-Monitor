import { describe, expect, it } from "vitest";
import { validateWebhookUrl } from "../../packages/domain/src/ssl/networkSafety.js";

describe("webhook SSRF validation", () => {
  it("rejects non-HTTPS webhook URLs", async () => {
    await expect(validateWebhookUrl("http://example.com")).rejects.toThrow();
  });

  it("rejects arbitrary webhook ports", async () => {
    await expect(
      validateWebhookUrl("https://example.com:8443"),
    ).rejects.toThrow();
  });

  it("rejects localhost webhook targets before any outbound request", async () => {
    await expect(validateWebhookUrl("https://127.0.0.1")).rejects.toThrow();
  });

  it("rejects embedded credentials", async () => {
    await expect(
      validateWebhookUrl("https://user:secret@example.com"),
    ).rejects.toThrow();
  });
});
