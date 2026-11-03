import fs from "fs";
import os from "os";
import path from "path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileTypeFromStream = vi.hoisted(() => vi.fn());

vi.mock("file-type", () => ({
  fileTypeFromStream,
}));

import { resolveUploadMime } from "../../src/services/upload-mime.js";

describe("resolveUploadMime", () => {
  let tempPath: string;

  beforeEach(() => {
    fileTypeFromStream.mockReset();
    tempPath = path.join(os.tmpdir(), `mime-${Date.now()}.bin`);
    fs.writeFileSync(tempPath, "not-a-real-image");
  });

  it("uses the expected image type", async () => {
    await expect(
      resolveUploadMime({ tempPath, expectedMimeType: "image/jpeg" })
    ).resolves.toEqual({ mimeType: "image/jpeg", extension: "jpg" });
    expect(fileTypeFromStream).not.toHaveBeenCalled();
  });

  it("prefers a concrete content-type header", async () => {
    await expect(
      resolveUploadMime({
        tempPath,
        expectedMimeType: "image/png",
        headerContentType: "video/mp4; charset=binary",
      })
    ).resolves.toEqual({ mimeType: "video/mp4", extension: "png" });
  });

  it("sniffs the file when no type was declared", async () => {
    fileTypeFromStream.mockResolvedValue({ mime: "image/gif", ext: "gif" });
    await expect(
      resolveUploadMime({
        tempPath,
        headerContentType: "application/octet-stream",
      })
    ).resolves.toEqual({ mimeType: "image/gif", extension: "gif" });
  });

  it("uses the sniffed mime extension when the detector omits one", async () => {
    fileTypeFromStream.mockResolvedValue({ mime: "image/webp" });
    await expect(resolveUploadMime({ tempPath })).resolves.toEqual({
      mimeType: "image/webp",
      extension: "webp",
    });
  });

  it("rejects types that are not images or video", async () => {
    fileTypeFromStream.mockResolvedValue(undefined);
    await expect(resolveUploadMime({ tempPath })).rejects.toMatchObject({
      code: 400,
      error: "invalid_request",
    });
  });

  it("rejects a declared type outside the allow list", async () => {
    await expect(
      resolveUploadMime({ tempPath, expectedMimeType: "text/plain" })
    ).rejects.toMatchObject({ code: 400 });
  });
});
