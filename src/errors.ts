export class ApiError extends Error {
  code: number;
  error: string;
  retryAfter?: number;

  constructor(
    message: string,
    code: number,
    options?: { error?: string; retryAfter?: number }
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.error = options?.error ?? "service_unavailable";
    this.retryAfter = options?.retryAfter;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
