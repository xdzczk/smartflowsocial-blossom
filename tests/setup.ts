import os from "os";
import path from "path";

// Ensure loadConfig() does not exit in tests when required env is read
process.env["NODE_ENV"] = "test";
process.env["DB_PATH"] =
  process.env["DB_PATH"] ?? path.join(os.tmpdir(), "vibe-cdn-test-db");
process.env["R2_BUCKET"] = process.env["R2_BUCKET"] ?? "test-bucket";
process.env["R2_ENDPOINT"] =
  process.env["R2_ENDPOINT"] ?? "https://test.r2.dev";
process.env["R2_ACCESS_KEY_ID"] = process.env["R2_ACCESS_KEY_ID"] ?? "test-key";
process.env["R2_SECRET_ACCESS_KEY"] =
  process.env["R2_SECRET_ACCESS_KEY"] ?? "test-secret";
process.env["SFS_UPLOAD_TOKEN_SECRET"] =
  process.env["SFS_UPLOAD_TOKEN_SECRET"] ?? "test-upload-token-secret";
