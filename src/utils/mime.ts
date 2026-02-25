import mime from "mime";

/** Allowed MIME prefixes for uploads (images + video only) */
const ALLOWED_PREFIXES = ["image/", "video/"];

export function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_PREFIXES.some((p) => mimeType.toLowerCase().startsWith(p));
}

export function getExtension(mimeType: string): string | null {
  const ext = mime.getExtension(mimeType);
  if (ext === "jpeg") return "jpg";
  return ext;
}

export function getType(pathOrExt: string): string | null {
  return mime.getType(pathOrExt);
}
