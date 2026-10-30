import type { Context } from 'hono';
import type { ZodType, ZodTypeDef } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 423 | 429 | 500 | 503,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details);
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do that') => new ApiError(403, 'forbidden', message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'conflict', message, details);

/** Parse and validate a JSON body. Never trust the client: everything goes through a zod schema. */
export async function body<T>(c: Context, schema: ZodType<T, ZodTypeDef, unknown>, maxBytes = 1_000_000): Promise<T> {
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > maxBytes) throw new ApiError(413, 'payload_too_large', 'Request body is too large');
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > maxBytes) throw new ApiError(413, 'payload_too_large', 'Request body is too large');
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw badRequest('Invalid JSON body');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(422, 'validation_failed', 'Some fields are invalid', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export function query<T>(c: Context, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new ApiError(422, 'validation_failed', 'Invalid query parameters', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

/** Opaque cursor pagination on (created_at, id). */
export function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`).replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = atob(cursor).split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function page<T extends { created_at: string; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null };
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
