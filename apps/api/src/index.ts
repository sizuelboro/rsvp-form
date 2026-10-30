import { Hono, type Context } from 'hono';
import type { AppBindings, Env, QueueMessage } from './env';
import { ApiError } from './lib/http';
import { loadSession, requireCsrfHeader, requireUser, requireWorkspace } from './lib/auth';
import { escapeHtml } from './lib/format';
import { first } from './lib/db';
import { captureException } from './lib/monitoring';
import { auth } from './modules/auth';
import { workspace, workspacesRoot } from './modules/workspaces';
import { forms } from './modules/forms';
import { publicApi } from './modules/public';
import { events } from './modules/events';
import { guests } from './modules/guests';
import { submissions } from './modules/submissions';
import { checkins } from './modules/checkins';
import { analytics } from './modules/analytics';
import { notifications, notificationsPublic, handleQueue } from './modules/notifications';
import { templates } from './modules/templates';
import { billing, billingWebhooks } from './modules/billing';
import { integrations } from './modules/integrations';
import { search } from './modules/search';

const app = new Hono<AppBindings>();

// ─── Cross-cutting middleware ───
app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  const started = Date.now();
  await next();
  c.header('x-request-id', requestId);
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  if (c.req.path.startsWith('/api/')) {
    c.header('cache-control', c.res.headers.get('cache-control') ?? 'no-store');
    console.log(JSON.stringify({ msg: 'request', id: requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }));
  }
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
  }
  console.error(JSON.stringify({ msg: 'unhandled_error', id: c.get('requestId'), path: c.req.path, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }));
  try { c.executionCtx.waitUntil(captureException(c.env.SENTRY_DSN, err, { requestId: c.get('requestId'), path: c.req.path, method: c.req.method })); } catch { /* no execution context in tests */ }
  return c.json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.', requestId: c.get('requestId') } }, 500);
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

// ─── API v1 ───
const v1 = new Hono<AppBindings>();
v1.use('*', loadSession);
v1.get('/health', async (c) => {
  const db = await first<{ ok: number }>(c.env.DB, 'SELECT 1 AS ok').catch(() => null);
  return c.json({ ok: Boolean(db?.ok), time: new Date().toISOString() });
});

// Public endpoints (no auth). Separate router, separate rate limits.
v1.route('/public', publicApi);
v1.route('/public', notificationsPublic);
v1.route('/billing/webhooks', billingWebhooks);

// Authenticated endpoints
v1.use('/auth/*', requireCsrfHeader);
v1.route('/auth', auth);
v1.use('/workspaces/*', requireCsrfHeader, requireUser);
v1.route('/workspaces', workspacesRoot);

const ws = new Hono<AppBindings>();
ws.use('*', requireCsrfHeader, requireUser, requireWorkspace);
ws.route('/', workspace);
ws.route('/forms', forms);
ws.route('/events', events);
ws.route('/guests', guests);
ws.route('/submissions', submissions);
ws.route('/checkins', checkins);
ws.route('/analytics', analytics);
ws.route('/notifications', notifications);
ws.route('/templates', templates);
ws.route('/billing', billing);
ws.route('/integrations', integrations);
ws.route('/search', search);
v1.route('/w/:wid', ws);

app.route('/api/v1', v1);

// ─── Public pages: serve the lightweight renderer bundle with SEO metadata ───
async function publicPage(c: Context<AppBindings>, meta: { title: string; description: string; image?: string | null; noindex?: boolean }) {
  const res = await c.env.ASSETS.fetch(new URL('/public.html', c.req.url));
  const html = await res.text();
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description.slice(0, 200))}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description.slice(0, 200))}">`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}">` : '',
    meta.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
  ].join('');
  return c.html(html.replace(/<title>.*?<\/title>/s, tags), 200, { 'cache-control': 'public, max-age=60' });
}

app.get('/f/:slug', async (c) => {
  const f = await first<{ name: string; access: string; schema: string | null }>(c.env.DB, `SELECT f.name, f.access, v.schema FROM forms f LEFT JOIN form_versions v ON v.id = f.published_version_id WHERE f.slug = ? AND f.deleted_at IS NULL`, c.req.param('slug'));
  let description = 'Fill in this form';
  let title = f?.name ?? 'Form';
  if (f?.schema && f.access === 'public') {
    try { const s = JSON.parse(f.schema); title = s.form?.title ?? title; description = s.form?.description ?? description; } catch { /* ignore */ }
  }
  return publicPage(c, { title, description, noindex: !f || f.access !== 'public' });
});

app.get('/e/:slug', async (c) => {
  const e = await first<{ name: string; description: string; cover_image: string | null }>(c.env.DB, "SELECT name, description, cover_image FROM events WHERE slug = ? AND deleted_at IS NULL AND status != 'draft'", c.req.param('slug'));
  return publicPage(c, { title: e?.name ?? 'Event', description: e?.description || 'You’re invited', image: e?.cover_image, noindex: !e });
});

app.get('/i/:token', (c) => publicPage(c, { title: 'You’re invited', description: 'Personal invitation', noindex: true }));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = new Date().toISOString();
    // Uploads never attached to a submission within a day are orphans: remove the R2 object and the row.
    const orphans = await env.DB.prepare("SELECT key FROM uploads WHERE submission_id IS NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') LIMIT 1000").all<{ key: string }>();
    const keys = (orphans.results ?? []).map((r) => r.key);
    if (keys.length) await env.UPLOADS.delete(keys);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 86400),
      ...keys.map((k) => env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(k)),
    ]);
  },
} satisfies ExportedHandler<Env, QueueMessage>;

export { app };
