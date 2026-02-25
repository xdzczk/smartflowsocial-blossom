import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

import type { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Request } from "express";

import { ApiError } from "../errors.js";

import type { UploadLane } from "./upload-context.js";

const TEMP_DIR = "/tmp/sfs-blossom";

export interface StreamUploadResult {
  tempPath: string;
  tempKey: string;
  sha256: string;
  bytesRead: number;
}

export async function uploadRequestStream(params: {
  req: Request;
  client: S3Client;
  bucket: string;
  laneMaxBytes: number;
  laneExpectedSize?: number;
}): Promise<StreamUploadResult> {
  const { req, client, bucket, laneMaxBytes, laneExpectedSize } = params;
  const tempKey = `${crypto.randomBytes(20).toString("hex")}.temp`;
  const tempPath = path.join(TEMP_DIR, tempKey);
  let bytesRead = 0;
  let sha256: string | undefined;
  let savedLocal = false;

  const fileStream = fs.createWriteStream(tempPath);
  const hash = crypto.createHash("sha256").setEncoding("hex");
  const passThrough = new PassThrough();

  fileStream.on("finish", () => {
    savedLocal = true;
  });
  hash.on("finish", () => {
    hash.end();
    sha256 = hash.read() as string;
  });
  passThrough.on("data", (chunk: Buffer) => {
    bytesRead += chunk.length;
    if (
      bytesRead > laneMaxBytes ||
      (laneExpectedSize !== undefined && bytesRead > laneExpectedSize)
    ) {
      passThrough.destroy(new Error("MAX_SIZE"));
    }
  });

  passThrough.pipe(fileStream);
  passThrough.pipe(hash);
  const uploading = new Upload({
    client,
    params: {
      Bucket: bucket,
      Body: passThrough,
      Key: tempKey,
    },
  });

  req.pipe(passThrough);
  await uploading.done();

  if (
    bytesRead > laneMaxBytes ||
    (laneExpectedSize !== undefined && bytesRead > laneExpectedSize)
  ) {
    throw new ApiError("Payload too large", 413, {
      error: "payload_too_large",
    });
  }
  if (laneExpectedSize !== undefined && bytesRead !== laneExpectedSize) {
    throw new ApiError("Payload size does not match expected size", 400, {
      error: "invalid_request",
    });
  }
  if (!sha256 && savedLocal) {
    throw new ApiError("Hash not computed", 500);
  }
  if (!sha256) {
    throw new ApiError("Hash not computed", 500);
  }

  return { tempPath, tempKey, sha256, bytesRead };
}

export function laneMaxBytesFor(
  lane: UploadLane,
  configuredCompatMaxBytes: number
): number {
  const maxUploadBytes = 250 * 1024 * 1024;
  if (lane === "compat") {
    return Math.min(maxUploadBytes, configuredCompatMaxBytes);
  }
  return maxUploadBytes;
}
