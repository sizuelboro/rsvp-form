import type { Context, MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env';
import { ApiError } from './http';
import { hashIp } from './crypto';

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
}

/**
 * Fixed-window rate limiter backed by D1. Good enough for abuse prevention on public
 * endpoints; swap for the Workers Rate Limiting binding at higher scale.
 */
export async function hit(db: D1Database, key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  // opportunistic cleanup of stale windows
  if (Math.random() < 0.01) await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 86400).run();
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), reset: windowStart + windowSeconds };
}

/** RATE_LIMIT_SCALE lets local/e2e environments raise limits without code changes (default 1). */
export function scale(env: { RATE_LIMIT_SCALE?: string }): number {
  const n = Number(env.RATE_LIMIT_SCALE ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function rateLimit(name: string, limit: number, windowSeconds: number, by: 'ip' | 'user' = 'ip'): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const id = by === 'user' && c.get('user') ? c.get('user')!.id : await hashIp(clientIp(c), c.env.IP_HASH_SALT);
    const scaled = Math.round(limit * scale(c.env));
    const res = await hit(c.env.DB, `${name}:${id}`, scaled, windowSeconds);
    c.header('X-RateLimit-Limit', String(scaled));
    c.header('X-RateLimit-Remaining', String(res.remaining));
    if (!res.allowed) {
      c.header('Retry-After', String(Math.max(1, res.reset - Math.floor(Date.now() / 1000))));
      throw new ApiError(429, 'rate_limited', 'Too many requests. Please try again shortly.');
    }
    await next();
  };
}
