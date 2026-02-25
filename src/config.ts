function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    console.error(`Missing or empty required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name]?.trim() ?? defaultValue;
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function optionalBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on")
    return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off")
    return false;
  return defaultValue;
}

export interface Config {
  dbPath: string;
  r2: {
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  port: number;
  authToleranceSeconds: number;
  blossomPublicUrl: string;
  sfs: {
    internalUrl: string;
    internalSecret: string;
    uploadTokenSecret: string;
    commitBatchUrl: string;
    commitBatchSize: number;
    commitFlushMs: number;
    compatibilityMode: {
      enabled: boolean;
      maxUploadBytes: number;
    };
  };
  rateLimit: {
    uploadsBurst: number;
    uploadsPerMin: number;
    bytesBurst: number;
    bytesPerMin: number;
    ipUploadsPerMin: number;
    compatUploadsBurst: number;
    compatUploadsPerMin: number;
    compatBytesBurst: number;
    compatBytesPerMin: number;
  };
  nodeEnv: string;
  nativeBindingsPath: string | undefined;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;

  const dbPath = requireEnv("DB_PATH");
  const r2Bucket = requireEnv("R2_BUCKET");
  const r2Endpoint = requireEnv("R2_ENDPOINT");
  const r2AccessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  cached = {
    dbPath,
    r2: {
      bucket: r2Bucket,
      endpoint: r2Endpoint,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
    port: optionalInt("PORT", 5050),
    authToleranceSeconds: optionalInt("AUTH_TOLERANCE_SECONDS", 0),
    blossomPublicUrl: optionalEnv(
      "BLOSSOM_PUBLIC_URL",
      "https://blossom.smartflow.social"
    ),
    sfs: {
      internalUrl: optionalEnv("SFS_INTERNAL_URL", ""),
      internalSecret: optionalEnv("SFS_INTERNAL_SECRET", ""),
      uploadTokenSecret: optionalEnv(
        "SFS_UPLOAD_TOKEN_SECRET",
        optionalEnv("SFS_INTERNAL_SECRET", "")
      ),
      commitBatchUrl: optionalEnv(
        "SFS_COMMIT_BATCH_URL",
        `${optionalEnv("SFS_INTERNAL_URL", "").replace(/\/$/, "")}/internal/blossom/commit-batch`
      ),
      commitBatchSize: optionalInt("SFS_COMMIT_BATCH_SIZE", 20),
      commitFlushMs: optionalInt("SFS_COMMIT_FLUSH_MS", 2000),
      compatibilityMode: {
        enabled: optionalBool("SFS_COMPAT_MODE_ENABLED", true),
        maxUploadBytes: optionalInt(
          "SFS_COMPAT_MAX_UPLOAD_BYTES",
          50 * 1024 * 1024
        ),
      },
    },
    rateLimit: {
      uploadsBurst: optionalInt("RATE_LIMIT_UPLOADS_BURST", 20),
      uploadsPerMin: optionalInt("RATE_LIMIT_UPLOADS_PER_MIN", 10),
      bytesBurst: optionalInt("RATE_LIMIT_BYTES_BURST", 500 * 1024 * 1024),
      bytesPerMin: optionalInt("RATE_LIMIT_BYTES_PER_MIN", 200 * 1024 * 1024),
      ipUploadsPerMin: optionalInt("RATE_LIMIT_IP_UPLOADS_PER_MIN", 120),
      compatUploadsBurst: optionalInt("RATE_LIMIT_COMPAT_UPLOADS_BURST", 10),
      compatUploadsPerMin: optionalInt("RATE_LIMIT_COMPAT_UPLOADS_PER_MIN", 6),
      compatBytesBurst: optionalInt(
        "RATE_LIMIT_COMPAT_BYTES_BURST",
        150 * 1024 * 1024
      ),
      compatBytesPerMin: optionalInt(
        "RATE_LIMIT_COMPAT_BYTES_PER_MIN",
        60 * 1024 * 1024
      ),
    },
    nodeEnv: optionalEnv("NODE_ENV", "development"),
    nativeBindingsPath:
      process.env["NATIVE_BINDINGS_PATH"]?.trim() ?? undefined,
  };
  return cached;
}

/** Reset cached config (for tests). */
export function resetConfig(): void {
  cached = null;
}
