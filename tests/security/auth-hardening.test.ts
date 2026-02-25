import { describe, expect, it } from "vitest";

import { ApiError } from "../../src/errors.js";
import { parseBlossomAuthorizationHeader } from "../../src/services/auth.js";

describe("security auth hardening", () => {
  it("rejects invalid auth scheme", () => {
    expect(() => parseBlossomAuthorizationHeader("Basic abc")).toThrow(
      ApiError
    );
  });

  it("rejects malformed header payload", () => {
    expect(() => parseBlossomAuthorizationHeader("Bearer bad-base64")).toThrow(
      Error
    );
  });
});
