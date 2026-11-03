import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "../src/logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info, warn, and error as JSON lines", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    log.info("hello", { requestId: "r1" });
    log.warn("careful");
    log.error("boom", { err: "nope" });

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      level: "info",
      msg: "hello",
      requestId: "r1",
    });
    const warning = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      level: string;
    };
    expect(warning.level).toBe("warn");
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      msg: "boom",
      err: "nope",
    });
  });
});
