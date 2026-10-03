import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { verifyToken } from "../../packages/domain/src/auth/service.js";

describe("JWT security", () => {
  it("rejects an expired token", () => {
    const token = jwt.sign(
      {
        sub: "user-1",
        email: "user@example.com",
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: -1,
      },
    );

    expect(() => verifyToken(token)).toThrow();
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = jwt.sign(
      {
        sub: "user-1",
        email: "user@example.com",
      },
      "wrong-secret-that-is-not-the-real-secret",
    );

    expect(() => verifyToken(token)).toThrow();
  });

  it("rejects a malformed token", () => {
    expect(() => verifyToken("not.a.valid.jwt")).toThrow();
  });
});
it("rejects a token using an unexpected JWT algorithm", () => {
  const token = jwt.sign(
    {
      sub: "user-1",
      email: "user@example.com",
    },
    process.env.JWT_SECRET!,
    {
      algorithm: "HS384",
    },
  );

  expect(() => verifyToken(token)).toThrow();
});
