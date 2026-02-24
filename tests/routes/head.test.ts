import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Request } from "express";

import headRoute from "../../src/routes/head.js";

const headObjectMock = vi.fn();
vi.mock("../../src/services/storage.js", () => ({
  headObject: (key: string) => headObjectMock(key),
}));

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    end: vi.fn(),
  };
  return res;
}

function mockReq(params: { key?: string }): Request {
  return { params } as unknown as Request;
}

describe("HEAD /:key", () => {
  beforeEach(() => {
    headObjectMock.mockReset();
  });

  it("returns 400 when key is missing", async () => {
    const req = mockReq({});
    const res = mockRes();
    await expect(headRoute(req, res as never)).rejects.toMatchObject({
      message: "Missing or invalid key",
      code: 400,
    });
    expect(headObjectMock).not.toHaveBeenCalled();
  });

  it("returns 400 when key contains ..", async () => {
    const req = mockReq({ key: "a/../b" });
    const res = mockRes();
    await expect(headRoute(req, res as never)).rejects.toMatchObject({
      message: "Missing or invalid key",
      code: 400,
    });
    expect(headObjectMock).not.toHaveBeenCalled();
  });

  it("returns 404 when object does not exist", async () => {
    headObjectMock.mockResolvedValue({ exists: false });
    const req = mockReq({ key: "missing.jpg" });
    const res = mockRes();
    await headRoute(req, res as never);
    expect(headObjectMock).toHaveBeenCalledWith("missing.jpg");
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with Content-Type and Content-Length when exists", async () => {
    headObjectMock.mockResolvedValue({
      exists: true,
      contentType: "image/jpeg",
      contentLength: 1234,
    });
    const req = mockReq({ key: "abc.jpg" });
    const res = mockRes();
    await headRoute(req, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["content-length"]).toBe("1234");
    expect(res.end).toHaveBeenCalled();
  });
});
