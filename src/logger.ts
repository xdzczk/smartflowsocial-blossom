type LogLevel = "info" | "warn" | "error";

function logLine(
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>
): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = JSON.stringify(line);
  if (level === "error") {
    console.error(out);
  } else if (level === "warn") {
    console.warn(out);
  } else {
    console.info(out);
  }
}

export const log = {
  info(msg: string, fields?: Record<string, unknown>): void {
    logLine("info", msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    logLine("warn", msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    logLine("error", msg, fields);
  },
};
