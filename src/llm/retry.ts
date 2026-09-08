/**
 * Exponential backoff for free-tier rate limits and transient upstream
 * errors (1s, 2s, 4s, 8s, 16s), per implementation guide §8.5. Retries on
 * anything that looks like a 429 / rate-limit / quota error, OR a
 * transient 5xx (503 "high demand" / UNAVAILABLE, 500, 502, 504,
 * "overloaded"). Rethrows everything else (4xx auth/validation errors,
 * etc.) immediately.
 */
const DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "429",
  "rate limit",
  "quota",
  "resource_exhausted",
  "503",
  "unavailable",
  "high demand",
  "overloaded",
  "service unavailable",
  "internal error", // Gemini occasionally wraps transient faults this way
];

function looksRetryable(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.code;

  if (typeof status === "number" && RETRYABLE_STATUSES.has(status)) return true;
  if (typeof status === "string" && status.toUpperCase() === "UNAVAILABLE") return true;

  return RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) => msg.includes(fragment));
}

export async function withBackoff<T>(fn: () => Promise<T>, label = "llm-call"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!looksRetryable(err) || attempt === DELAYS_MS.length) {
        throw err;
      }
      const delay = DELAYS_MS[attempt];
      // eslint-disable-next-line no-console
      console.warn(
        `[${label}] retryable error (${String((err as any)?.status ?? (err as any)?.message ?? err).slice(
          0,
          120
        )}), retrying in ${delay}ms (attempt ${attempt + 1}/${DELAYS_MS.length})`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr;
}