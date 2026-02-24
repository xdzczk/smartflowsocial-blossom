import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const BUCKET = process.env["R2_BUCKET"] ?? "";
const ENDPOINT = process.env["R2_ENDPOINT"] ?? "";

let client: S3Client | null = null;

export function getR2Client(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env["R2_ACCESS_KEY_ID"] ?? "",
      secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"] ?? "",
    },
  });
  return client;
}

export async function copyObject(
  sourceKey: string,
  destKey: string,
  contentType: string
): Promise<void> {
  const c = getR2Client();
  await c.send(
    new CopyObjectCommand({
      CopySource: `/${BUCKET}/${sourceKey}`,
      Bucket: BUCKET,
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
      Bucket: BUCKET,
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
  try {
    const out = await c.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
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
