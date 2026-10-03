import { describe, expect, it } from "vitest";
import { authSchema } from "../../packages/shared/src/validation/index.js";
describe("auth validation", () => {
  it("requires 12-character passwords", () =>
    expect(() =>
      authSchema.parse({ email: "x@y.com", password: "short" }),
    ).toThrow());
  it("normalizes email", () =>
    expect(
      authSchema.parse({
        email: " User@Example.COM ",
        password: "123456789012",
      }).email,
    ).toBe("user@example.com"));
});
