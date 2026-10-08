// Retry delays (SPEC section 7.2). Both are deterministic so tests can assert them.

export interface BackoffConfig {
  retryBaseDelayS: number;
  retryMaxDelayS: number;
}

/** 32-bit FNV-1a. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Task-level retry delay after attempt `attempt` failed: capped exponential, no jitter. */
export function taskBackoff(attempt: number, config: BackoffConfig): number {
  const n = Math.max(1, attempt);
  return Math.min(config.retryBaseDelayS * 2 ** (n - 1), config.retryMaxDelayS);
}

/** Queue-level retry delay for delivery attempt `attempts` of message `messageId`, with deterministic jitter. */
export function backoff(attempts: number, messageId: string, config: BackoffConfig): number {
  const jitter = fnv1a32(messageId) % (config.retryBaseDelayS + 1);
  return taskBackoff(attempts, config) + jitter;
}
