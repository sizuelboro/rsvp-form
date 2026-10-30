import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings, Env } from '../env';
import { permission } from '../lib/auth';
import { hmacSha256Hex, newId, timingSafeEqual } from '../lib/crypto';
import { all, first, nowIso, run } from '../lib/db';
import { ApiError, body, notFound, parseJson, query } from '../lib/http';
import { escapeHtml } from '../lib/format';

export const EMAIL_TYPES = [
  'invitation', 'rsvp_confirmation', 'rsvp_decline', 'event_reminder', 'deadline_reminder',
  'organizer_notification', 'event_update', 'cancellation', 'workspace_invitation',
] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

/** Types that honour the workspace suppression (unsubscribe) list. */
const SUPPRESSIBLE: EmailType[] = ['invitation', 'event_reminder', 'deadline_reminder', 'event_update'];

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailType, { subject: string; body: string; cta?: string; variables: string[] }> = {
  invitation: { subject: 'You’re invited: {{event}}', body: 'Hi {{name}},\n\nYou’re invited to {{event}}.\n\nWhen: {{date}}\nWhere: {{venue}}\n\nPlease let us know if you can make it{{deadline_text}}.', cta: 'RSVP now', variables: ['name', 'event', 'date', 'venue', 'deadline_text', 'link'] },
  rsvp_confirmation: { subject: 'Your RSVP for {{event}} is confirmed', body: 'Hi {{name}},\n\nThanks for your RSVP to {{event}}. We have you down for {{party_size}}.\n\nWhen: {{date}}\nWhere: {{venue}}\n\nYou can update your response at any time using the link below.', cta: 'View or update RSVP', variables: ['name', 'event', 'date', 'venue', 'party_size', 'link', 'qr_link'] },
  rsvp_decline: { subject: 'We’ll miss you at {{event}}', body: 'Hi {{name}},\n\nThanks for letting us know you can’t make it to {{event}}. If your plans change, you can update your response below.', cta: 'Update RSVP', variables: ['name', 'event', 'link'] },
  event_reminder: { subject: 'Reminder: {{event}} is coming up', body: 'Hi {{name}},\n\nThis is a friendly reminder that {{event}} is on {{date}} at {{venue}}.\n\nWe look forward to seeing you!', cta: 'View details', variables: ['name', 'event', 'date', 'venue', 'link'] },
  deadline_reminder: { subject: 'Please RSVP for {{event}}', body: 'Hi {{name}},\n\nWe haven’t heard from you yet. Please let us know if you can attend {{event}}{{deadline_text}}.', cta: 'RSVP now', variables: ['name', 'event', 'deadline_text', 'link'] },
  organizer_notification: { subject: 'New response: {{form}}', body: 'Hi {{name}},\n\nSomeone {{action}} on {{form}}.\n\n{{summary}}', cta: 'Open response', variables: ['name', 'form', 'action', 'summary', 'link'] },
  event_update: { subject: 'Update: {{event}}', body: 'Hi {{name}},\n\n{{message}}\n\nWhen: {{date}}\nWhere: {{venue}}', cta: 'View event', variables: ['name', 'event', 'message', 'date', 'venue', 'link'] },
  cancellation: { subject: 'Cancelled: {{event}}', body: 'Hi {{name}},\n\nWe’re sorry to let you know that {{event}} has been cancelled.\n\n{{message}}', variables: ['name', 'event', 'message'] },
  workspace_invitation: { subject: '{{inviter}} invited you to {{workspace}}', body: 'Hi,\n\n{{inviter}} has invited you to collaborate in {{workspace}}.', cta: 'Accept invitation', variables: ['inviter', 'workspace', 'link'] },
};

const fill = (t: string, vars: Record<string, string>, html: boolean) =>
  t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => (html ? escapeHtml(vars[k] ?? '') : vars[k] ?? ''));

export function renderEmail(tpl: { subject: string; body: string; cta?: string }, vars: Record<string, string>, opts: { appName: string; unsubscribeUrl?: string }) {
  const subject = fill(tpl.subject, vars, false).replace(/[\r\n]+/g, ' ').slice(0, 250);
  const text = `${fill(tpl.body, vars, false)}${vars.link && tpl.cta ? `\n\n${tpl.cta}: ${vars.link}` : ''}${opts.unsubscribeUrl ? `\n\nUnsubscribe: ${opts.unsubscribeUrl}` : ''}`;
  const paragraphs = fill(tpl.body, vars, true).split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const safeLink = vars.link && /^https?:\/\//.test(vars.link) ? escapeHtml(vars.link) : null;
  const qr = vars.qr_link && /^https?:\/\//.test(vars.qr_link) ? `<p style="margin:24px 0 0;text-align:center"><img src="${escapeHtml(vars.qr_link)}" width="160" height="160" alt="Your entry QR code"></p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#FAF9F6;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#232334">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border:1px solid #ECEAF2;border-radius:14px"><tr><td style="padding:36px 36px 28px;font-size:15px">
${paragraphs}
${safeLink && tpl.cta ? `<p style="margin:28px 0 0"><a href="${safeLink}" style="display:inline-block;background:#5146D8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">${escapeHtml(tpl.cta)}</a></p>` : ''}
${qr}
</td></tr></table>
<p style="font-size:12px;color:#777786;margin:20px 0 0">Sent with ${escapeHtml(opts.appName)}${opts.unsubscribeUrl ? ` · <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#777786">Unsubscribe</a>` : ''}</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

async function unsubscribeUrl(env: Env, workspaceId: string, email: string): Promise<string> {
  const sig = (await hmacSha256Hex(env.IP_HASH_SALT ?? 'dev-secret-change-me', `unsub:${workspaceId}:${email.toLowerCase()}`)).slice(0, 32);
  return `${env.APP_URL}/api/v1/public/unsubscribe?w=${encodeURIComponent(workspaceId)}&e=${encodeURIComponent(email)}&s=${sig}`;
}

export interface EnqueueEmail {
  workspaceId: string;
  type: EmailType;
  to: string;
  vars: Record<string, string>;
  subject?: string;
  invitationId?: string;
  idempotencyKey?: string;
}

/** Render with the workspace's (editable) template, persist a job, and hand it to the queue. */
export async function enqueueEmail(env: Env, e: EnqueueEmail): Promise<{ jobId: string | null; suppressed: boolean }> {
  const db = env.DB;
  if (SUPPRESSIBLE.includes(e.type)) {
    const s = await first(db, 'SELECT 1 FROM email_suppressions WHERE workspace_id = ? AND email = ?', e.workspaceId, e.to);
    if (s) return { jobId: null, suppressed: true };
  }
  if (e.idempotencyKey) {
    const existing = await first<{ id: string }>(db, 'SELECT id FROM notification_jobs WHERE idempotency_key = ?', e.idempotencyKey);
    if (existing) return { jobId: existing.id, suppressed: false };
  }
  const custom = await first<{ subject: string; body: string }>(db, 'SELECT subject, body FROM email_templates WHERE workspace_id = ? AND type = ?', e.workspaceId, e.type);
  const def = DEFAULT_EMAIL_TEMPLATES[e.type];
  const tpl = { subject: e.subject ?? custom?.subject ?? def.subject, body: custom?.body ?? def.body, cta: def.cta };
  const rendered = renderEmail(tpl, e.vars, { appName: env.APP_NAME, unsubscribeUrl: SUPPRESSIBLE.includes(e.type) ? await unsubscribeUrl(env, e.workspaceId, e.to) : undefined });
  const id = newId('job');
  await run(db, `INSERT INTO notification_jobs (id, workspace_id, type, channel, recipient, subject, payload, invitation_id, idempotency_key) VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?)`,
    id, e.workspaceId, e.type, e.to, rendered.subject, JSON.stringify({ html: rendered.html, text: rendered.text }), e.invitationId ?? null, e.idempotencyKey ?? null);
  await env.NOTIFICATIONS.send({ jobId: id });
  return { jobId: id, suppressed: false };
}

/** Fan out an event to enabled webhook integrations. */
export async function enqueueWebhooks(env: Env, workspaceId: string, event: string, data: Record<string, unknown>): Promise<void> {
  const hooks = await all<{ id: string; config: string }>(env.DB, "SELECT id, config FROM integrations WHERE workspace_id = ? AND type = 'webhook' AND enabled = 1", workspaceId);
  for (const h of hooks) {
    const cfg = parseJson<{ url?: string; events?: string[] }>(h.config, {});
    if (!cfg.url || (event !== 'webhook.test' && cfg.events?.length && !cfg.events.includes(event))) continue;
    const id = newId('job');
    await run(env.DB, `INSERT INTO notification_jobs (id, workspace_id, type, channel, recipient, payload) VALUES (?, ?, ?, 'webhook', ?, ?)`,
      id, workspaceId, event, h.id, JSON.stringify({ event, data, sentAt: nowIso() }));
    await env.NOTIFICATIONS.send({ jobId: id });
  }
}

// ───────────── Queue consumer ─────────────

interface JobRow {
  id: string; workspace_id: string; type: string; channel: 'email' | 'webhook'; recipient: string; subject: string | null;
  payload: string; status: string; attempts: number; max_attempts: number; invitation_id: string | null;
}

async function deliverEmail(env: Env, job: JobRow): Promise<{ providerId: string; delivered: boolean }> {
  const payload = parseJson<{ html: string; text: string }>(job.payload, { html: '', text: '' });
  if (env.EMAIL_MODE !== 'resend') {
    console.log(JSON.stringify({ msg: 'email.logged', to: job.recipient, subject: job.subject, type: job.type }));
    return { providerId: `log_${job.id}`, delivered: true };
  }
  if (!env.RESEND_API_KEY) throw new Error('Email provider is not configured (RESEND_API_KEY missing)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': job.id },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [job.recipient], subject: job.subject, html: payload.html, text: payload.text, tags: [{ name: 'job_id', value: job.id }] }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { id: string };
  return { providerId: json.id, delivered: false };
}

async function deliverWebhook(env: Env, job: JobRow): Promise<void> {
  const hook = await first<{ config: string; signing_secret: string | null; enabled: number }>(env.DB, 'SELECT config, signing_secret, enabled FROM integrations WHERE id = ?', job.recipient);
  if (!hook || !hook.enabled) throw new Error('Webhook integration disabled or removed');
  const url = parseJson<{ url?: string }>(hook.config, {}).url;
  if (!url || !/^https:\/\//.test(url)) throw new Error('Webhook URL must use https');
  const ts = Math.floor(Date.now() / 1000);
  const sig = hook.signing_secret ? await hmacSha256Hex(hook.signing_secret, `${ts}.${job.payload}`) : '';
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-invitely-timestamp': String(ts), 'x-invitely-signature': `v1=${sig}`, 'x-invitely-event': job.type }, body: job.payload });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
}

export async function processJob(env: Env, jobId: string): Promise<'done' | 'retry' | 'failed' | 'skipped'> {
  const db = env.DB;
  const job = await first<JobRow>(db, 'SELECT * FROM notification_jobs WHERE id = ?', jobId);
  if (!job || !['queued', 'processing'].includes(job.status)) return 'skipped';
  const claimed = await run(db, "UPDATE notification_jobs SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status IN ('queued','processing') AND attempts = ?", nowIso(), job.id, job.attempts);
  if (!claimed.meta.changes) return 'skipped';
  try {
    const ts = nowIso();
    if (job.channel === 'email') {
      const r = await deliverEmail(env, job);
      await run(db, 'UPDATE notification_jobs SET status = ?, provider_message_id = ?, sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?', r.delivered ? 'delivered' : 'sent', r.providerId, ts, ts, job.id);
      if (job.invitation_id) await run(db, "UPDATE invitations SET status = ?, sent_at = COALESCE(sent_at, ?), delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END, last_error = NULL, updated_at = ? WHERE id = ?", r.delivered ? 'delivered' : 'sent', ts, r.delivered ? 'delivered' : 'sent', ts, ts, job.invitation_id);
    } else {
      await deliverWebhook(env, job);
      await run(db, "UPDATE notification_jobs SET status = 'delivered', sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?", ts, ts, job.id);
    }
    return 'done';
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const final = job.attempts + 1 >= job.max_attempts;
    await run(db, 'UPDATE notification_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?', final ? 'failed' : 'queued', message, nowIso(), job.id);
    if (final && job.invitation_id) await run(db, "UPDATE invitations SET status = 'failed', last_error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", message, nowIso(), job.invitation_id);
    console.error(JSON.stringify({ msg: 'notification.failed', jobId: job.id, attempt: job.attempts + 1, error: message }));
    return final ? 'failed' : 'retry';
  }
}

export async function handleQueue(batch: MessageBatch<{ jobId: string }>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const result = await processJob(env, msg.body.jobId);
    if (result === 'retry') msg.retry({ delaySeconds: Math.min(600, 15 * 2 ** msg.attempts) });
    else msg.ack();
  }
}

// ───────────── Workspace routes (/w/:wid/notifications) ─────────────

export const notifications = new Hono<AppBindings>();

notifications.get('/jobs', async (c) => {
  const q = query(c, z.object({ status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }));
  const items = await all(c.env.DB, `SELECT id, type, channel, recipient, subject, status, attempts, last_error, sent_at, created_at FROM notification_jobs
    WHERE workspace_id = ? ${q.status ? 'AND status = ?' : ''} ORDER BY created_at DESC LIMIT ?`, ...[c.get('workspace').id, ...(q.status ? [q.status] : []), q.limit]);
  return c.json({ items });
});

notifications.post('/jobs/:jobId/retry', permission('invitations.send'), async (c) => {
  const wid = c.get('workspace').id;
  const res = await run(c.env.DB, "UPDATE notification_jobs SET status = 'queued', attempts = 0, last_error = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'failed'", nowIso(), c.req.param('jobId'), wid);
  if (!res.meta.changes) throw notFound('Failed job');
  const job = await first<{ invitation_id: string | null }>(c.env.DB, 'SELECT invitation_id FROM notification_jobs WHERE id = ?', c.req.param('jobId'));
  if (job?.invitation_id) await run(c.env.DB, "UPDATE invitations SET status = 'queued', updated_at = ? WHERE id = ?", nowIso(), job.invitation_id);
  await c.env.NOTIFICATIONS.send({ jobId: c.req.param('jobId') });
  return c.json({ ok: true });
});

notifications.post('/jobs/retry-failed', permission('invitations.send'), async (c) => {
  const wid = c.get('workspace').id;
  const failed = await all<{ id: string; invitation_id: string | null }>(c.env.DB, "SELECT id, invitation_id FROM notification_jobs WHERE workspace_id = ? AND status = 'failed' LIMIT 500", wid);
  for (const j of failed) {
    await run(c.env.DB, "UPDATE notification_jobs SET status = 'queued', attempts = 0, last_error = NULL, updated_at = ? WHERE id = ?", nowIso(), j.id);
    if (j.invitation_id) await run(c.env.DB, "UPDATE invitations SET status = 'queued', updated_at = ? WHERE id = ?", nowIso(), j.invitation_id);
    await c.env.NOTIFICATIONS.send({ jobId: j.id });
  }
  return c.json({ retried: failed.length });
});

notifications.get('/email-templates', async (c) => {
  const custom = await all<{ type: string; subject: string; body: string; updated_at: string }>(c.env.DB, 'SELECT type, subject, body, updated_at FROM email_templates WHERE workspace_id = ?', c.get('workspace').id);
  return c.json({
    items: EMAIL_TYPES.map((type) => {
      const o = custom.find((x) => x.type === type);
      const d = DEFAULT_EMAIL_TEMPLATES[type];
      return { type, subject: o?.subject ?? d.subject, body: o?.body ?? d.body, isCustom: Boolean(o), variables: d.variables, updatedAt: o?.updated_at ?? null };
    }),
  });
});

notifications.put('/email-templates/:type', permission('content.write'), async (c) => {
  const type = z.enum(EMAIL_TYPES).safeParse(c.req.param('type'));
  if (!type.success) throw notFound('Template');
  const input = await body(c, z.object({ subject: z.string().trim().min(1).max(250), body: z.string().trim().min(1).max(10000) }));
  await run(c.env.DB, `INSERT INTO email_templates (id, workspace_id, type, subject, body) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, type) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = ?`, newId('etp'), c.get('workspace').id, type.data, input.subject, input.body, nowIso());
  return c.json({ ok: true });
});

notifications.delete('/email-templates/:type', permission('content.write'), async (c) => {
  await run(c.env.DB, 'DELETE FROM email_templates WHERE workspace_id = ? AND type = ?', c.get('workspace').id, c.req.param('type'));
  return c.json({ ok: true });
});

notifications.post('/email-templates/:type/preview', async (c) => {
  const type = z.enum(EMAIL_TYPES).safeParse(c.req.param('type'));
  if (!type.success) throw notFound('Template');
  const input = await body(c, z.object({ subject: z.string().max(250), body: z.string().max(10000) }));
  const def = DEFAULT_EMAIL_TEMPLATES[type.data];
  const sample: Record<string, string> = { name: 'Priya', event: 'Sarah & John’s Wedding', date: 'Saturday, 12 December 2026 at 18:00', venue: 'The Leela Palace, Udaipur', deadline_text: ' by 15 November', party_size: '2', link: 'https://example.com/i/sample', form: 'Wedding RSVP', action: 'submitted a response', summary: 'Attendance: Joyfully accept', inviter: 'Sam', workspace: 'Acme Events', message: 'The ceremony now starts at 5 PM.' };
  return c.json(renderEmail({ subject: input.subject, body: input.body, cta: def.cta }, sample, { appName: c.env.APP_NAME }));
});

// ───────────── Public routes ─────────────

export const notificationsPublic = new Hono<AppBindings>();

notificationsPublic.get('/unsubscribe', async (c) => {
  const w = c.req.query('w') ?? '';
  const e = (c.req.query('e') ?? '').toLowerCase();
  const s = c.req.query('s') ?? '';
  const expected = (await hmacSha256Hex(c.env.IP_HASH_SALT ?? 'dev-secret-change-me', `unsub:${w}:${e}`)).slice(0, 32);
  const enc = new TextEncoder();
  if (!w || !e || !timingSafeEqual(enc.encode(expected), enc.encode(s))) throw new ApiError(400, 'bad_request', 'Invalid unsubscribe link');
  await run(c.env.DB, 'INSERT OR IGNORE INTO email_suppressions (workspace_id, email) VALUES (?, ?)', w, e);
  return c.html('<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:48px;text-align:center;color:#232334"><h1 style="font-weight:600">You’re unsubscribed</h1><p>You won’t receive further invitations or reminders from this organizer.</p></body>');
});

/** Resend delivery webhooks (Svix-signed). Configure RESEND_WEBHOOK_SECRET to enable. */
notificationsPublic.post('/webhooks/resend', async (c) => {
  const secret = (c.env as Env & { RESEND_WEBHOOK_SECRET?: string }).RESEND_WEBHOOK_SECRET;
  if (!secret) throw new ApiError(503, 'not_configured', 'Webhook secret not configured');
  const id = c.req.header('svix-id') ?? '';
  const ts = c.req.header('svix-timestamp') ?? '';
  const sigs = (c.req.header('svix-signature') ?? '').split(' ').map((s) => s.split(',')[1]);
  const raw = await c.req.text();
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new ApiError(400, 'bad_request', 'Stale webhook');
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const expected = btoa(String.fromCharCode(...mac));
  if (!sigs.includes(expected)) throw new ApiError(401, 'invalid_signature', 'Invalid signature');
  const evt = parseJson<{ type?: string; data?: { email_id?: string } }>(raw, {});
  const providerId = evt.data?.email_id;
  if (providerId && (evt.type === 'email.delivered' || evt.type === 'email.bounced')) {
    const status = evt.type === 'email.delivered' ? 'delivered' : 'failed';
    const job = await first<{ id: string; invitation_id: string | null }>(c.env.DB, 'SELECT id, invitation_id FROM notification_jobs WHERE provider_message_id = ?', providerId);
    if (job) {
      await run(c.env.DB, 'UPDATE notification_jobs SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), job.id);
      if (job.invitation_id) await run(c.env.DB, `UPDATE invitations SET status = ?, ${status === 'delivered' ? 'delivered_at' : 'updated_at'} = ?, updated_at = ? WHERE id = ?`, status, nowIso(), nowIso(), job.invitation_id);
    }
  }
  return c.json({ ok: true });
});
