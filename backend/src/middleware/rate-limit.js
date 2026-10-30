/**
 * D1 / SQLite-backed fixed-window rate limiter.
 * Protects sensitive authentication and mutation endpoints against brute force and abuse.
 */

export async function checkRateLimit(db, bucketKey, {
  limit = 20,
  windowMs = 60_000,
  nowMs = Date.now()
} = {}) {
  if (!db) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }

  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const expiresAtMs = windowStartMs + windowMs;
  const scopedKey = `${bucketKey}:${windowStartMs}`;

  // Opportunistic cleanup of expired buckets
  await db
    .prepare('DELETE FROM rate_limits WHERE expires_at_ms <= ?')
    .bind(nowMs)
    .run();

  await db
    .prepare(
      `INSERT INTO rate_limits (bucket_key, count, window_start_ms, expires_at_ms)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`
    )
    .bind(scopedKey, windowStartMs, expiresAtMs)
    .run();

  const row = await db
    .prepare('SELECT count, expires_at_ms FROM rate_limits WHERE bucket_key = ?')
    .bind(scopedKey)
    .first();

  const currentCount = row ? Number(row.count) : 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1000));

  if (currentCount > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - currentCount),
    retryAfterSeconds: 0
  };
}
