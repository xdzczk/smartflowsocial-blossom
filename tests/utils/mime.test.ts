import { describe, it, expect } from "vitest";

import { isAllowedMime, getExtension, getType } from "../../src/utils/mime.js";

describe("mime utils", () => {
  describe("isAllowedMime", () => {
    it("allows image/* types", () => {
      expect(isAllowedMime("image/jpeg")).toBe(true);
      expect(isAllowedMime("image/png")).toBe(true);
      expect(isAllowedMime("image/webp")).toBe(true);
      expect(isAllowedMime("IMAGE/JPEG")).toBe(true);
    });

    it("allows video/* types", () => {
      expect(isAllowedMime("video/mp4")).toBe(true);
      expect(isAllowedMime("video/webm")).toBe(true);
      expect(isAllowedMime("VIDEO/MP4")).toBe(true);
    });

    it("rejects other types", () => {
      expect(isAllowedMime("application/octet-stream")).toBe(false);
      expect(isAllowedMime("text/plain")).toBe(false);
      expect(isAllowedMime("")).toBe(false);
    });
  });

  describe("getExtension", () => {
    it("returns extension for known mime types", () => {
      expect(getExtension("image/jpeg")).toBe("jpg");
      expect(getExtension("image/png")).toBe("png");
      expect(getExtension("video/mp4")).toBe("mp4");
    });

    it("returns null for unknown", () => {
      expect(getExtension("application/x-unknown")).toBe(null);
    });
  });

  describe("getType", () => {
    it("returns mime type for extension", () => {
      expect(getType("jpg")).toBe("image/jpeg");
      expect(getType("png")).toBe("image/png");
      expect(getType(".mp4")).toBe("video/mp4");
    });

    it("returns null for unknown extension", () => {
      expect(getType("unknownxyz")).toBe(null);
    });
  });
});
