import { describe, it, expect } from "vitest";

describe("server", () => {
  it("exports start as a function", async () => {
    const mod = await import("../src/server");
    expect(typeof mod.start).toBe("function");
  });
});
