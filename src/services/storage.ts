import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

import { loadConfig } from "../config.js";

let client: S3Client | null = null;

/** Reset cached client (for tests only). */
export function __resetR2ClientForTesting(): void {
  client = null;
}

export function getR2Client(): S3Client {
  if (!client) {
    const { r2 } = loadConfig();
    client = new S3Client({
      region: "auto",
      endpoint: r2.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    });
  }
  return client;
}

export async function copyObject(
  sourceKey: string,
  destKey: string,
  contentType: string
): Promise<void> {
  const c = getR2Client();
  const bucket = loadConfig().r2.bucket;
  await c.send(
    new CopyObjectCommand({
      CopySource: `/${bucket}/${sourceKey}`,
      Bucket: bucket,
      Key: destKey,
      MetadataDirective: "REPLACE",
      ContentType: contentType,
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  const c = getR2Client();
  await c.send(
    new DeleteObjectCommand({
      Bucket: loadConfig().r2.bucket,
      Key: key,
    })
  );
}

export async function headObject(key: string): Promise<{
  exists: boolean;
  contentType?: string;
  contentLength?: number;
}> {
  const c = getR2Client();
  const bucket = loadConfig().r2.bucket;
  try {
    const out = await c.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return {
      exists: true,
      contentType: out.ContentType,
      contentLength: out.ContentLength,
    };
  } catch (err: unknown) {
    const e = err as { name?: string };
    if (e?.name === "NotFound" || e?.name === "NoSuchKey") {
      return { exists: false };
    }
    throw err;
  }
}
