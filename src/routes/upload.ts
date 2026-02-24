import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

import { Upload } from "@aws-sdk/lib-storage";
import type { Response } from "express";
import { fileTypeFromStream } from "file-type";

import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { log } from "../logger.js";
import * as storage from "../services/storage.js";
import { verifySubscription } from "../services/subscription.js";
import type { AppRequest } from "../types.js";
import { isAllowedMime, getExtension, getType } from "../utils/mime.js";

const TEMP_DIR = "/tmp/sfs-blossom";
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

export default async function upload(
  req: AppRequest,
  res: Response
): Promise<void> {
  let tempPath: string | undefined;
  let tempKey: string | undefined;
  let bytesRead = 0;
  const config = loadConfig();
  const client = storage.getR2Client();
  const bucket = config.r2.bucket;

  try {
    if (req.blossom?.verb !== "upload") {
      throw new ApiError("Expected t tag value 'upload'", 401);
    }

    const contentLength = req.headers["content-length"];
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (!isNaN(len) && len > MAX_UPLOAD_BYTES) {
        throw new ApiError("Payload too large (max 250MB)", 413);
      }
    }

    const active = await verifySubscription(req.blossom.auth.pubkey);
    if (!active) {
      throw new ApiError("Subscription required", 403);
    }

    let expectedHash: string | undefined;
    for (const tag of req.blossom.auth.tags) {
      if (tag[0] === "x") {
        if (expectedHash) {
          throw new ApiError("Duplicate x tag", 401);
        }
        expectedHash = tag[1];
      }
    }
    if (!expectedHash) {
      throw new ApiError(
        "A x tag with a content hash is required in the auth header",
        401
      );
    }

    tempKey = `${crypto.randomBytes(20).toString("hex")}.temp`;
    tempPath = path.join(TEMP_DIR, tempKey);

    const fileStream = fs.createWriteStream(tempPath);
    const hash = crypto.createHash("sha256").setEncoding("hex");
    const passThrough = new PassThrough();

    let savedLocal = false;
    let sha256: string | undefined;

    fileStream.on("finish", () => {
      savedLocal = true;
    });

    hash.on("finish", () => {
      hash.end();
      sha256 = hash.read() as string;
    });

    passThrough.on("data", (chunk: Buffer) => {
      bytesRead += chunk.length;
      if (bytesRead > MAX_UPLOAD_BYTES) {
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

    if (bytesRead > MAX_UPLOAD_BYTES) {
      throw new ApiError("Payload too large (max 250MB)", 413);
    }

    if (!sha256 && savedLocal) {
      throw new ApiError("Hash not computed", 500);
    }

    if (expectedHash !== sha256) {
      throw new ApiError(
        "Hash given in x tag does not match detected content hash",
        401
      );
    }

    let ext: string | null = null;
    let mimeType: string | undefined;
    const nameTag = req.blossom.auth.tags.find((t) => t[0] === "name");

    if (nameTag) {
      const filename = nameTag[1];
      ext = filename !== undefined ? (filename.split(".").pop() ?? null) : null;
      mimeType = ext ? (getType(ext) ?? undefined) : undefined;
    }

    const headerMime = req.headers["content-type"];
    const headerMimeStr =
      typeof headerMime === "string" ? headerMime : undefined;
    if (headerMimeStr && headerMimeStr !== "application/octet-stream") {
      mimeType = headerMimeStr.split(";")[0]?.trim();
      if (!ext && mimeType) ext = getExtension(mimeType);
    }

    if (!mimeType && tempPath) {
      const readStream = fs.createReadStream(tempPath);
      // Node ReadStream is not typed as AnyWebByteStream; file-type accepts it at runtime
      const fileInfo = await fileTypeFromStream(
        readStream as unknown as Parameters<typeof fileTypeFromStream>[0]
      );
      if (fileInfo) {
        mimeType = fileInfo.mime;
        ext = fileInfo.ext ?? getExtension(fileInfo.mime);
      }
    }

    if (!mimeType) {
      mimeType = "application/octet-stream";
      ext = null;
    }

    if (!isAllowedMime(mimeType)) {
      throw new ApiError("Only image and video types are allowed", 400);
    }

    if (sha256 === undefined) {
      throw new ApiError("Hash not computed", 500);
    }
    const finalKey = ext ? `${sha256}.${ext}` : sha256;
    await storage.copyObject(tempKey, finalKey, mimeType);

    const stat = await fs.promises.stat(tempPath);
    const size = stat.size;

    req.app.db.createBlob({
      key: finalKey,
      pubkey: req.blossom.auth.pubkey,
      type: mimeType,
      size,
    });

    await storage.deleteObject(tempKey);

    const url = `${config.blossomPublicUrl.replace(/\/$/, "")}/${finalKey}`;

    res.json({
      url,
      x: sha256,
      size,
      m: mimeType,
    });
  } catch (err) {
    if (bytesRead > MAX_UPLOAD_BYTES) {
      throw new ApiError("Payload too large (max 250MB)", 413);
    }
    throw err;
  } finally {
    if (tempPath) {
      await fs.promises.unlink(tempPath).catch((err: unknown) => {
        log.warn("Upload cleanup: failed to unlink temp file", {
          tempPath,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (tempKey) {
      await storage.deleteObject(tempKey).catch((err: unknown) => {
        log.warn("Upload cleanup: failed to delete temp object", {
          tempKey,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}
