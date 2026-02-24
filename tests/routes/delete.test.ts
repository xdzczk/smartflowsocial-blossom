import { beforeEach, describe, expect, it, vi } from "vitest";

import deleteRoute from "../../src/routes/delete.js";
import type { AppRequest } from "../../src/types.js";

const deleteObjectMock = vi.fn();
vi.mock("../../src/services/storage.js", () => ({
  deleteObject: (key: string) => deleteObjectMock(key),
}));

function mockRes() {
  return {
    statusCode: 0,
    end: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
}

function createReq(
  overrides: Partial<{
    params: { key?: string };
    blossom: { verb: string; auth: { pubkey: string; tags: string[][] } };
    app: { db: { deleteBlob: (key: string, pubkey: string) => boolean } };
  }> = {}
): AppRequest {
  const defaultDeleteBlob = vi.fn();
  return {
    params: { key: "some.key" },
    blossom: {
      verb: "delete",
      auth: { pubkey: "pk", tags: [["x", "sha256hash"]] },
    },
    app: { db: { deleteBlob: defaultDeleteBlob } },
    ...overrides,
  } as unknown as AppRequest;
}

describe("DELETE /:key", () => {
  beforeEach(() => {
    deleteObjectMock.mockReset();
  });

  it("returns 401 when verb is not delete", async () => {
    const req = createReq({
      blossom: { verb: "upload", auth: { pubkey: "p", tags: [] } },
    });
    const res = mockRes();
    await expect(deleteRoute(req, res as never)).rejects.toMatchObject({
      message: "Expected t tag value 'delete'",
      code: 401,
    });
  });

  it("returns 400 when key is missing", async () => {
    const req = createReq({ params: {} });
    const res = mockRes();
    await expect(deleteRoute(req, res as never)).rejects.toMatchObject({
      message: "Missing key",
      code: 400,
    });
    expect(req.app.db.deleteBlob).not.toHaveBeenCalled();
  });

  it("returns 401 when x tag is missing", async () => {
    const req = createReq({
      blossom: { verb: "delete", auth: { pubkey: "p", tags: [] } },
    });
    const res = mockRes();
    await expect(deleteRoute(req, res as never)).rejects.toMatchObject({
      message: "Missing x tag",
      code: 401,
    });
  });

  it("returns 204 and does not call storage when db says not found", async () => {
    const req = createReq({ params: { key: "key.jpg" } });
    vi.mocked(req.app.db.deleteBlob).mockReturnValue(false);
    const res = mockRes();
    await deleteRoute(req, res as never);
    expect(req.app.db.deleteBlob).toHaveBeenCalledWith("key.jpg", "pk");
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("returns 204 and calls storage.deleteObject when db deletes", async () => {
    deleteObjectMock.mockResolvedValue(undefined);
    const req = createReq({ params: { key: "key.jpg" } });
    vi.mocked(req.app.db.deleteBlob).mockReturnValue(true);
    const res = mockRes();
    await deleteRoute(req, res as never);
    expect(req.app.db.deleteBlob).toHaveBeenCalledWith("key.jpg", "pk");
    expect(deleteObjectMock).toHaveBeenCalledWith("key.jpg");
    expect(res.statusCode).toBe(204);
  });
});
