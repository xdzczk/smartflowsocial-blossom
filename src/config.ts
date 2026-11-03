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

function optionalRateLimitMode(
  name: string,
  defaultValue: "local" | "redis"
): "local" | "redis" {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "local" || raw === "redis") return raw;
  return defaultValue;
}

function optionalTrustProxy(name: string): boolean | number | string {
  const raw = process.env[name]?.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") {
    return true;
  }
  if (lower === "false" || lower === "0" || lower === "no" || lower === "off") {
    return false;
  }
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isNaN(numeric) && String(numeric) === raw && numeric >= 0) {
    return numeric;
  }
  return raw;
}

export interface Config {
  dbPath: string;
  trustProxy: boolean | number | string;
  corsAllowedOrigins: string[];
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
    commitMaxAttempts: number;
    policyUrl: string;
    policyCacheTtlSec: number;
    compatibilityMode: {
      enabled: boolean;
      maxUploadBytes: number;
      dailyBytesLimit: number;
    };
    readinessMaxPendingCommits: number;
    readinessMaxDeadLetterCommits: number;
  };
  rateLimit: {
    mode: "local" | "redis";
    redisUrl: string;
    redisKeyPrefix: string;
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
  observability: {
    metricsToken: string;
    metricsAllowlist: string[];
  };
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;

  const dbPath = requireEnv("DB_PATH");
  const r2Bucket = requireEnv("R2_BUCKET");
  const r2Endpoint = requireEnv("R2_ENDPOINT");
  const r2AccessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const uploadTokenSecret = requireEnv("SFS_UPLOAD_TOKEN_SECRET");
  const internalSecret = optionalEnv("SFS_INTERNAL_SECRET", "");
  if (internalSecret && internalSecret === uploadTokenSecret) {
    console.error(
      "SFS_UPLOAD_TOKEN_SECRET must be distinct from SFS_INTERNAL_SECRET"
    );
    process.exit(1);
  }

  cached = {
    dbPath,
    r2: {
      bucket: r2Bucket,
      endpoint: r2Endpoint,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
    port: optionalInt("PORT", 5050),
    authToleranceSeconds: optionalInt("AUTH_TOLERANCE_SECONDS", 60),
    trustProxy: optionalTrustProxy("TRUST_PROXY"),
    corsAllowedOrigins: optionalEnv("CORS_ALLOWED_ORIGINS", "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    blossomPublicUrl: optionalEnv(
      "BLOSSOM_PUBLIC_URL",
      "https://blossom.smartflow.social"
    ),
    sfs: {
      internalUrl: optionalEnv("SFS_INTERNAL_URL", ""),
      internalSecret,
      uploadTokenSecret,
      commitBatchUrl: optionalEnv(
        "SFS_COMMIT_BATCH_URL",
        `${optionalEnv("SFS_INTERNAL_URL", "").replace(/\/$/, "")}/internal/blossom/commit-batch`
      ),
      commitBatchSize: optionalInt("SFS_COMMIT_BATCH_SIZE", 20),
      commitFlushMs: optionalInt("SFS_COMMIT_FLUSH_MS", 2000),
      commitMaxAttempts: optionalInt("SFS_COMMIT_MAX_ATTEMPTS", 10),
      policyUrl: optionalEnv(
        "SFS_POLICY_URL",
        `${optionalEnv("SFS_INTERNAL_URL", "").replace(/\/$/, "")}/internal/blossom/policy`
      ),
      policyCacheTtlSec: optionalInt("SFS_POLICY_CACHE_TTL_SEC", 90),
      compatibilityMode: {
        enabled: optionalBool("SFS_COMPAT_MODE_ENABLED", true),
        maxUploadBytes: optionalInt(
          "SFS_COMPAT_MAX_UPLOAD_BYTES",
          50 * 1024 * 1024
        ),
        dailyBytesLimit: optionalInt(
          "SFS_COMPAT_DAILY_BYTES_LIMIT",
          500 * 1024 * 1024
        ),
      },
      readinessMaxPendingCommits: optionalInt(
        "SFS_READINESS_MAX_PENDING_COMMITS",
        1000
      ),
      readinessMaxDeadLetterCommits: optionalInt(
        "SFS_READINESS_MAX_DEAD_LETTER_COMMITS",
        0
      ),
    },
    rateLimit: {
      mode: optionalRateLimitMode("RATE_LIMIT_MODE", "local"),
      redisUrl: optionalEnv("RATE_LIMIT_REDIS_URL", ""),
      redisKeyPrefix: optionalEnv("RATE_LIMIT_REDIS_KEY_PREFIX", "sfs:rl"),
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
    observability: {
      metricsToken: optionalEnv("METRICS_TOKEN", ""),
      metricsAllowlist: optionalEnv("METRICS_ALLOWLIST", "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    },
  };
  return cached;
}

/** Reset cached config (for tests). */
export function resetConfig(): void {
  cached = null;
}
