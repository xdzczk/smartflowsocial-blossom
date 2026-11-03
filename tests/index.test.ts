import { afterEach, describe, expect, it, vi } from "vitest";

const start = vi.hoisted(() => vi.fn());

vi.mock("../src/server.js", () => ({
  start,
}));

describe("process entrypoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs a boot failure and exits", async () => {
    start.mockRejectedValueOnce(new Error("boot failed"));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as typeof process.exit);

    await import("../src/index.js");
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(error).toHaveBeenCalled();
  });
});
