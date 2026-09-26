// Provider-level failures (mirror of backend/app/providers/base.py).
export class ProviderError extends Error {
  constructor(message: string, public code = "provider_error", public status: number | null = null, public retryAfterS: number | null = null) {
    super(message);
    this.name = "ProviderError";
  }
}
export class QuotaExceeded extends ProviderError {
  constructor(retryAfterS: number | null = null) { super("quota exceeded", "quota_exceeded", 429, retryAfterS); }
}
export class UpstreamDegraded extends ProviderError {
  constructor(message = "upstream degraded", retryAfterS: number | null = null) { super(message, "upstream_degraded", 503, retryAfterS); }
}

/** Validation / lookup failure surfaced to the UI in the app's single error shape (§6.5). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
