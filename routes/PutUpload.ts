import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { fileTypeFromStream } from "file-type";
import { PassThrough } from "stream";
import { encode } from "magnet-uri";
import createTorrent from "create-torrent";
import parseTorrent from "parse-torrent";
import mime from "mime";
import crypto from "crypto";
import OS from "os";
import fs from "fs";
import { Response } from "express";
import R2Client from "./R2Client.js";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

function ComputeTorrentInfo(
  input: string,
  options: object = {}
): Promise<{ magnet: string; infohash: string; size: number }> {
  return new Promise((resolve, reject) => {
    createTorrent(
      input,
      options,
      async (err: Error | null, torrentFile: Buffer) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const parsed = await parseTorrent(torrentFile);
          resolve({
            magnet: encode(parsed),
            infohash: parsed.infoHash ?? "",
            size: parsed.length ?? 0,
          });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export default async function PutUpload(
  req: AppRequest,
  res: Response
): Promise<void> {
  let client: ReturnType<typeof R2Client> | undefined;
  let tempName: string | undefined;
  let tempPath: string | undefined;
  let expectedHash: string | undefined;

  try {
    if (req.blossom?.verb !== "upload") {
      throw { code: 401, message: "Expected t tag value 'upload'" } as ApiError;
    }

    const { timeRemaining } = req.app.db.getAccount(req.blossom!.auth.pubkey);

    if (timeRemaining !== Infinity && timeRemaining <= 0) {
      throw { code: 402, message: "Payment required" } as ApiError;
    }

    tempName = `${crypto.randomBytes(20).toString("hex")}.temp`;
    tempPath = `${OS.homedir()}/temp/${tempName}`;

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

    passThrough.pipe(fileStream);
    passThrough.pipe(hash);

    client = R2Client();

    const uploading = new Upload({
      client,
      params: {
        Bucket: process.env.S3_BUCKET ?? "",
        Body: passThrough,
        Key: tempName,
      },
    });

    req.pipe(passThrough);

    await uploading.done();

    if (!sha256 && savedLocal) {
      throw { code: 500 } as ApiError;
    }

    for (const tag of req.blossom!.auth.tags) {
      if (tag[0] === "x") {
        if (expectedHash) {
          throw { code: 401, message: "Duplicate x tag" } as ApiError;
        }
        expectedHash = tag[1];
      }
    }

    if (expectedHash === undefined) {
      throw {
        code: 401,
        message: "A x tag with a content hash is required in the auth header",
      } as ApiError;
    }

    if (expectedHash !== sha256) {
      throw {
        code: 401,
        message: "Hash given in x tag does not match detected content hash",
      } as ApiError;
    }

    const readLocal = fs.createReadStream(tempPath);

    let ext: string | null = null;
    let mimeType: string | undefined;
    const nameTag = req.blossom!.auth.tags.find((tag) => tag[0] === "name");

    if (nameTag) {
      const filename = nameTag[1];
      ext = filename.split(".").pop() ?? null;
      mimeType = ext ? (mime.getType(ext) ?? undefined) : undefined;
    }

    const headerMime = req.headers["content-type"];
    if (headerMime && headerMime !== "application/octet-stream") {
      mimeType = headerMime;
      if (!ext) ext = mime.getExtension(mimeType) ?? null;
    }

    if (!mimeType) {
      const fileInfo = await fileTypeFromStream(readLocal);
      if (fileInfo) {
        mimeType = fileInfo.mime;
        ext = fileInfo.ext ?? mime.getExtension(fileInfo.mime) ?? null;
      }
    }

    if (!mimeType) {
      mimeType = "application/octet-stream";
      ext = null;
    }

    const copyParams = {
      CopySource: `/${process.env.S3_BUCKET}/${tempName}`,
      Bucket: process.env.S3_BUCKET ?? "",
      MetadataDirective: "REPLACE" as const,
      ContentType: mimeType,
      Key: sha256!,
    };

    const resolved = await Promise.all([
      ComputeTorrentInfo(tempPath, { name: sha256 }),
      client.send(new CopyObjectCommand(copyParams)),
    ]);

    const { size } = resolved[0];

    const url = `${process.env.CDN_ENDPOINT}/${ext ? `${sha256}.${ext}` : sha256}`;

    const record = req.app.db.createBlob({
      pubkey: req.blossom!.auth.pubkey,
      type: mimeType,
      sha256: sha256!,
      size,
      ext,
    });

    res.json({
      created: record.created,
      type: mimeType,
      sha256,
      size,
      url,
    });
  } catch (err) {
    const e = err as ApiError;
    console.log(err);
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  } finally {
    try {
      if (tempPath) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    } catch (err) {
      console.log("error cleaning up temp local", err);
    }
    try {
      if (tempName && client) {
        await client
          .send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: tempName,
            })
          )
          .catch(() => {});
      }
    } catch (err) {
      console.log("error cleaning up temp remote", err);
    }
  }
}
