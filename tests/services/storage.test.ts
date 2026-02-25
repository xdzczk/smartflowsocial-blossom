import { beforeEach, describe, it, expect, vi } from "vitest";

import { resetConfig } from "../../src/config.js";
import * as storage from "../../src/services/storage.js";

const mockSend = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = mockSend;
  },
  CopyObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  HeadObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

describe("storage", () => {
  beforeEach(() => {
    process.env["SFS_UPLOAD_TOKEN_SECRET"] = "test-secret";
    process.env["R2_BUCKET"] = "test-bucket";
    process.env["R2_ENDPOINT"] = "https://test.r2.dev";
    process.env["R2_ACCESS_KEY_ID"] = "test-key";
    process.env["R2_SECRET_ACCESS_KEY"] = "test-secret";
    process.env["DB_PATH"] = "/tmp/vibe-cdn-storage-test";
    resetConfig();
    storage.__resetR2ClientForTesting();
    mockSend.mockReset();
  });

  describe("headObject", () => {
    it("returns exists true when HeadObject succeeds", async () => {
      mockSend.mockResolvedValueOnce({
        ContentType: "image/jpeg",
        ContentLength: 1234,
      });
      const result = await storage.headObject("abc.jpg");
      expect(result).toEqual({
        exists: true,
        contentType: "image/jpeg",
        contentLength: 1234,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("returns exists false when NotFound", async () => {
      mockSend.mockRejectedValueOnce({ name: "NotFound" });
      const result = await storage.headObject("missing");
      expect(result).toEqual({ exists: false });
    });

    it("returns exists false when NoSuchKey", async () => {
      mockSend.mockRejectedValueOnce({ name: "NoSuchKey" });
      const result = await storage.headObject("missing");
      expect(result).toEqual({ exists: false });
    });

    it("rethrows other errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("network"));
      await expect(storage.headObject("k")).rejects.toThrow("network");
    });
  });

  describe("copyObject", () => {
    it("calls send with CopySource, Bucket, Key, ContentType", async () => {
      mockSend.mockResolvedValueOnce({});
      await storage.copyObject("src.temp", "dest.jpg", "image/jpeg");
      const call = mockSend.mock.calls[0];
      expect(call).toBeDefined();
      type SentCommand = { input?: Record<string, unknown> };
      const cmd: SentCommand | undefined = call?.[0] as SentCommand | undefined;
      // toMatchObject with expect.stringContaining triggers no-unsafe-assignment
      expect(cmd?.input).toMatchObject({
        Bucket: "test-bucket",
        Key: "dest.jpg",
        ContentType: "image/jpeg",
        MetadataDirective: "REPLACE",
      });
      expect(String(cmd?.input?.["CopySource"])).toContain("src.temp");
    });
  });

  describe("deleteObject", () => {
    it("calls send with Bucket and Key", async () => {
      mockSend.mockResolvedValueOnce({});
      await storage.deleteObject("key.to.delete");
      const call = mockSend.mock.calls[0];
      expect(call).toBeDefined();
      type SentCommand = { input?: Record<string, unknown> };
      const cmd: SentCommand | undefined = call?.[0] as SentCommand | undefined;
      expect(cmd?.input).toMatchObject({
        Bucket: "test-bucket",
        Key: "key.to.delete",
      });
    });
  });
});
