import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

import { Upload } from "@aws-sdk/lib-storage";
import type { Response } from "express";
import { fileTypeFromStream } from "file-type";

import * as storage from "../services/storage.js";
import { verifySubscription } from "../services/subscription.js";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";
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
  const client = storage.getR2Client();
  const bucket = process.env["R2_BUCKET"] ?? "";

  try {
    if (req.blossom?.verb !== "upload") {
      throw { code: 401, message: "Expected t tag value 'upload'" } as ApiError;
    }

    const contentLength = req.headers["content-length"];
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (!isNaN(len) && len > MAX_UPLOAD_BYTES) {
        throw {
          code: 413,
          message: "Payload too large (max 250MB)",
        } as ApiError;
      }
    }

    const active = await verifySubscription(req.blossom.auth.pubkey);
    if (!active) {
      throw { code: 403, message: "Subscription required" } as ApiError;
    }

    let expectedHash: string | undefined;
    for (const tag of req.blossom.auth.tags) {
      if (tag[0] === "x") {
        if (expectedHash) {
          throw { code: 401, message: "Duplicate x tag" } as ApiError;
        }
        expectedHash = tag[1];
      }
    }
    if (!expectedHash) {
      throw {
        code: 401,
        message: "A x tag with a content hash is required in the auth header",
      } as ApiError;
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
      throw { code: 413, message: "Payload too large (max 250MB)" } as ApiError;
    }

    if (!sha256 && savedLocal) {
      throw { code: 500, message: "Hash not computed" } as ApiError;
    }

    if (expectedHash !== sha256) {
      throw {
        code: 401,
        message: "Hash given in x tag does not match detected content hash",
      } as ApiError;
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
      throw {
        code: 400,
        message: "Only image and video types are allowed",
      } as ApiError;
    }

    if (sha256 === undefined) {
      throw { code: 500, message: "Hash not computed" } as ApiError;
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

    const publicUrl =
      process.env["BLOSSOM_PUBLIC_URL"] ?? "https://blossom.smartflow.social";
    const url = `${publicUrl.replace(/\/$/, "")}/${finalKey}`;

    res.json({
      url,
      x: sha256,
      size,
      m: mimeType,
    });
  } catch (err) {
    const e = err as ApiError & { message?: string };
    if (bytesRead > MAX_UPLOAD_BYTES) {
      res.status(413).json({ message: "Payload too large (max 250MB)" });
      return;
    }
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  } finally {
    if (tempPath) {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
    if (tempKey) {
      await storage.deleteObject(tempKey).catch(() => {});
    }
  }
}
