import { describe, it, expect } from "vitest";

import { ApiError } from "../src/errors.js";

describe("ApiError", () => {
  it("extends Error", () => {
    const err = new ApiError("test", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it("has code and message", () => {
    const err = new ApiError("Something failed", 503);
    expect(err.message).toBe("Something failed");
    expect(err.code).toBe(503);
  });

  it("has a stack trace", () => {
    const err = new ApiError("stack", 500);
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("ApiError");
  });

  it("has name ApiError", () => {
    const err = new ApiError("n", 400);
    expect(err.name).toBe("ApiError");
  });
});
