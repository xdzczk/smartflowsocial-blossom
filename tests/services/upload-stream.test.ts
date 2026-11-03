import fs from "fs";
import { Readable, type Readable as ReadableStream } from "stream";

import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/lib-storage", () => {
  return {
    Upload: class Upload {
      private body: ReadableStream;
      constructor(opts: { params: { Body: ReadableStream } }) {
        this.body = opts.params.Body;
      }
      done(): Promise<void> {
        return new Promise((resolve) => {
          this.body.on("error", () => resolve());
          this.body.on("end", () => {
            setTimeout(resolve, 15);
          });
        });
      }
    },
  };
});

import {
  laneMaxBytesFor,
  uploadRequestStream,
} from "../../src/services/upload-stream.js";

function asRequest(payload: Buffer): Request {
  return Readable.from([payload]) as unknown as Request;
}

describe("upload streams", () => {
  beforeEach(() => {
    fs.mkdirSync("/tmp/sfs-blossom", { recursive: true });
  });

  it("hashes a payload that fits the lane", async () => {
    const payload = Buffer.from("hello-blossom");
    const result = await uploadRequestStream({
      req: asRequest(payload),
      client: {} as never,
      bucket: "bucket",
      laneMaxBytes: 1024,
    });
    expect(result.bytesRead).toBe(payload.length);
    expect(result.sha256).toHaveLength(64);
    expect(fs.existsSync(result.tempPath)).toBe(true);
    fs.rmSync(result.tempPath, { force: true });
  });

  it("rejects a payload larger than the lane", async () => {
    await expect(
      uploadRequestStream({
        req: asRequest(Buffer.from("too-big")),
        client: {} as never,
        bucket: "bucket",
        laneMaxBytes: 2,
      })
    ).rejects.toMatchObject({ code: 413, error: "payload_too_large" });
  });

  it("rejects a payload that does not match the expected size", async () => {
    await expect(
      uploadRequestStream({
        req: asRequest(Buffer.from("abcd")),
        client: {} as never,
        bucket: "bucket",
        laneMaxBytes: 1024,
        laneExpectedSize: 2,
      })
    ).rejects.toMatchObject({ code: 413 });

    await expect(
      uploadRequestStream({
        req: asRequest(Buffer.from("abcd")),
        client: {} as never,
        bucket: "bucket",
        laneMaxBytes: 1024,
        laneExpectedSize: 8,
      })
    ).rejects.toMatchObject({ code: 400, error: "invalid_request" });
  });

  it("caps compatibility lanes and leaves authoritative lanes at the hard max", () => {
    expect(laneMaxBytesFor("authoritative", 10)).toBe(250 * 1024 * 1024);
    expect(laneMaxBytesFor("compat", 1024)).toBe(1024);
    expect(laneMaxBytesFor("compat", 1024 * 1024 * 1024)).toBe(
      250 * 1024 * 1024
    );
  });
});
