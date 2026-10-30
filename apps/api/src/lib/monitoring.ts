/**
 * Minimal Sentry reporter (envelope API) — no SDK dependency. Enabled when SENTRY_DSN is set.
 * Only error metadata is sent: no request bodies, cookies or guest data.
 */
export async function captureException(dsn: string | undefined, err: unknown, ctx: { requestId?: string; path?: string; method?: string; release?: string }): Promise<void> {
  if (!dsn) return;
  let url: URL;
  try { url = new URL(dsn); } catch { return; }
  const key = url.username;
  const project = url.pathname.replace(/^\//, '');
  if (!key || !project) return;
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const e = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    release: ctx.release,
    environment: 'production',
    tags: { request_id: ctx.requestId ?? '', route: ctx.path ?? '' },
    request: { method: ctx.method, url: ctx.path },
    exception: { values: [{ type: e.name, value: e.message.slice(0, 1000), stacktrace: e.stack ? { frames: e.stack.split('\n').slice(1, 30).reverse().map((l) => ({ function: l.trim().slice(0, 200) })) } : undefined }] },
  };
  const body = `${JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
  await fetch(`${url.protocol}//${url.host}/api/${project}/envelope/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=invitely-worker/0.1` },
    body,
  }).catch(() => undefined);
}
