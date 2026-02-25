import fs from "fs";

import { fileTypeFromStream } from "file-type";

import { ApiError } from "../errors.js";
import { getExtension, isAllowedMime } from "../utils/mime.js";

export async function resolveUploadMime(params: {
  tempPath: string;
  expectedMimeType?: string;
  headerContentType?: string;
}): Promise<{ mimeType: string; extension: string | null }> {
  const { tempPath, expectedMimeType, headerContentType } = params;
  let mimeType: string | undefined = expectedMimeType;
  let extension = expectedMimeType
    ? (getExtension(expectedMimeType) ?? null)
    : null;

  if (headerContentType && headerContentType !== "application/octet-stream") {
    mimeType = headerContentType.split(";")[0]?.trim();
    if (!extension && mimeType) extension = getExtension(mimeType);
  }

  if (!mimeType) {
    const readStream = fs.createReadStream(tempPath);
    const fileInfo = await fileTypeFromStream(
      readStream as unknown as Parameters<typeof fileTypeFromStream>[0]
    );
    if (fileInfo) {
      mimeType = fileInfo.mime;
      extension = fileInfo.ext ?? getExtension(fileInfo.mime);
    }
  }

  if (!mimeType) {
    mimeType = "application/octet-stream";
    extension = null;
  }
  if (!isAllowedMime(mimeType)) {
    throw new ApiError("Only image and video types are allowed", 400, {
      error: "invalid_request",
    });
  }

  return { mimeType, extension };
}
