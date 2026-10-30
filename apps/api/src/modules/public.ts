import { Hono, type Context } from 'hono';
import { renderSVG } from 'uqr';
import { z } from 'zod';
import {
  answerIndexText, deriveRsvp, findElement, formatAnswer, interpolate, migrateSchema, validateAnswers, FIELD_DEFINITIONS,
  type FileRef, type FormSchema,
} from '@rsvp/core';
import type { AppBindings, Env } from '../env';
import { hashIp, hmacSha256Hex, newId, sha256, timingSafeEqual, verifyPassword } from '../lib/crypto';
import { all, first, isUniqueViolation, nowIso, run } from '../lib/db';
import { ApiError, body, notFound, parseJson } from '../lib/http';
import { clientIp, hit, rateLimit, scale } from '../lib/ratelimit';
import { getEntitlements, usage } from '../lib/entitlements';
import { applyRsvp, assertCapacity, ensureEventGuest, ensureInvitation, findOrCreateGuest, sessionsForOptions } from '../services/rsvp';
import { enqueueEmail, enqueueWebhooks } from './notifications';

export const publicApi = new Hono<AppBindings>();

// ───────────── Loading published content ─────────────

interface PublicFormBase {
  formId: string;
  workspaceId: string;
  slug: string;
  name: string;
  status: string;
  access: 'public' | 'password' | 'invite_only';
  closesAt: string | null;
  latePolicy: 'block' | 'allow' | 'flag';
  closedMessage: string | null;
  versionId: string;
  version: number;
  schema: FormSchema;
  event: PublicEvent | null;
  hideBranding: boolean;
}

export interface PublicEvent {
  id: string; name: string; slug: string; description: string; startsAt: string | null; endsAt: string | null; timezone: string;
  venueName: string | null; address: string | null; coverImage: string | null; rsvpDeadline: string | null; status: string;
  sessions: { id: string; name: string; description: string; startsAt: string | null; endsAt: string | null; venueName: string | null; address: string | null; optionId: string | null }[];
}

const cacheKey = (env: Env, slug: string) => `${env.APP_URL}/__cache/public-form/${encodeURIComponent(slug)}`;

export async function purgePublicFormCache(c: Context<AppBindings>, slug: string): Promise<void> {
  try { await caches.default.delete(cacheKey(c.env, slug)); } catch { /* cache unavailable */ }
}

export async function loadPublicEvent(db: D1Database, eventId: string): Promise<PublicEvent | null> {
  const e = await first<Record<string, string | null>>(db, "SELECT * FROM events WHERE id = ? AND deleted_at IS NULL AND status != 'draft'", eventId);
  if (!e) return null;
  const sessions = await all<Record<string, string | null>>(db, 'SELECT id, name, description, starts_at, ends_at, venue_name, address, option_id FROM event_sessions WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, starts_at', eventId);
  return {
    id: e.id!, name: e.name!, slug: e.slug!, description: e.description ?? '', startsAt: e.starts_at ?? null, endsAt: e.ends_at ?? null, timezone: e.timezone ?? 'UTC',
    venueName: e.venue_name ?? null, address: e.address ?? null, coverImage: e.cover_image ?? null, rsvpDeadline: e.rsvp_deadline ?? null, status: e.status!,
    sessions: sessions.map((s) => ({ id: s.id!, name: s.name!, description: s.description ?? '', startsAt: s.starts_at ?? null, endsAt: s.ends_at ?? null, venueName: s.venue_name ?? null, address: s.address ?? null, optionId: s.option_id ?? null })),
  };
}

/** Load the published version for a slug. Cached for 60s via the Cache API; purged on publish/settings change. */
async function loadPublishedForm(c: Context<AppBindings>, slug: string): Promise<PublicFormBase> {
  const key = cacheKey(c.env, slug);
  try {
    const hitRes = await caches.default.match(key);
    if (hitRes) return (await hitRes.json()) as PublicFormBase;
  } catch { /* ignore */ }

  const f = await first<{ id: string; workspace_id: string; slug: string; name: string; status: string; access: PublicFormBase['access']; closes_at: string | null; late_policy: PublicFormBase['latePolicy']; closed_message: string | null; published_version_id: string | null }>(
    c.env.DB, 'SELECT id, workspace_id, slug, name, status, access, closes_at, late_policy, closed_message, published_version_id FROM forms WHERE slug = ? AND deleted_at IS NULL', slug);
  if (!f || !f.published_version_id || f.status === 'draft') throw notFound('Form');
  const v = await first<{ id: string; version: number; schema: string }>(c.env.DB, 'SELECT id, version, schema FROM form_versions WHERE id = ?', f.published_version_id);
  if (!v) throw notFound('Form');
  const migrated = migrateSchema(parseJson(v.schema, {}));
  if (!migrated.ok) throw new ApiError(500, 'schema_error', 'This form cannot be displayed');
  const link = await first<{ event_id: string }>(c.env.DB, 'SELECT event_id FROM event_forms WHERE form_id = ? ORDER BY is_primary DESC LIMIT 1', f.id);
  const event = link ? await loadPublicEvent(c.env.DB, link.event_id) : null;
  const ws = await first<{ branding: string }>(c.env.DB, 'SELECT branding FROM workspaces WHERE id = ?', f.workspace_id);
  const ent = await getEntitlements(c.env.DB, f.workspace_id);
  const hideBranding = Boolean(parseJson<{ hideBranding?: boolean }>(ws?.branding, {}).hideBranding && ent.features.customBranding) || Boolean(migrated.schema.settings.hideBranding && ent.features.customBranding);
  const base: PublicFormBase = {
    formId: f.id, workspaceId: f.workspace_id, slug: f.slug, name: f.name, status: f.status, access: f.access,
    closesAt: f.closes_at, latePolicy: f.late_policy, closedMessage: f.closed_message,
    versionId: v.id, version: v.version, schema: migrated.schema, event, hideBranding,
  };
  try {
    await caches.default.put(key, new Response(JSON.stringify(base), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } }));
  } catch { /* ignore */ }
  return base;
}

function effectiveDeadline(f: PublicFormBase): string | null {
  const candidates = [f.closesAt, f.event?.rsvpDeadline].filter((d): d is string => Boolean(d));
  return candidates.length ? candidates.sort()[0]! : null;
}

function closedState(f: PublicFormBase): { closed: boolean; reason?: 'closed' | 'deadline' | 'cancelled'; late: boolean } {
  if (f.status === 'closed') return { closed: true, reason: 'closed', late: false };
  if (f.event?.status === 'cancelled') return { closed: true, reason: 'cancelled', late: false };
  const deadline = effectiveDeadline(f);
  if (deadline && deadline < nowIso()) {
    if (f.latePolicy === 'block') return { closed: true, reason: 'deadline', late: true };
    return { closed: false, late: true };
  }
  return { closed: false, late: false };
}

// ───────────── Access tokens for password-protected forms ─────────────

const secret = (env: Env) => env.IP_HASH_SALT ?? 'dev-secret-change-me';

async function signAccess(env: Env, formId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  return `${exp}.${await hmacSha256Hex(secret(env), `form-access:${formId}:${exp}`)}`;
}

async function verifyAccess(env: Env, formId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmacSha256Hex(secret(env), `form-access:${formId}:${exp}`);
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(expected), enc.encode(sig));
}

interface InvitationContext {
  invitationId: string; eventId: string; eventGuestId: string; guestId: string; formId: string | null;
  guest: { name: string; email: string | null; phone: string | null };
  rsvpStatus: string; workspaceId: string;
}

async function loadInvitation(db: D1Database, token: string): Promise<InvitationContext | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return first<InvitationContext>(db, `
    SELECT i.id AS invitationId, i.event_id AS eventId, i.event_guest_id AS eventGuestId, eg.guest_id AS guestId, i.form_id AS formId,
      json_object('name', g.name, 'email', g.email, 'phone', g.phone) AS guest, eg.rsvp_status AS rsvpStatus, i.workspace_id AS workspaceId
    FROM invitation_tokens t JOIN invitations i ON i.id = t.invitation_id JOIN event_guests eg ON eg.id = i.event_guest_id JOIN guests g ON g.id = eg.guest_id
    JOIN events e ON e.id = i.event_id
    WHERE t.token = ? AND t.purpose = 'rsvp' AND t.revoked_at IS NULL AND e.deleted_at IS NULL AND g.deleted_at IS NULL`, token)
    .then((r) => (r ? { ...r, guest: typeof r.guest === 'string' ? JSON.parse(r.guest) : r.guest } : null));
}

function publicPayload(f: PublicFormBase, extra: Record<string, unknown> = {}) {
  const state = closedState(f);
  return {
    form: { slug: f.slug, name: f.name, version: f.version },
    schema: f.schema,
    event: f.event,
    access: f.access,
    closed: state.closed,
    closedReason: state.reason ?? null,
    closedMessage: state.closed ? f.closedMessage || (state.reason === 'cancelled' ? 'This event has been cancelled.' : 'This form is no longer accepting responses.') : null,
    deadline: effectiveDeadline(f),
    hideBranding: f.hideBranding,
    ...extra,
  };
}

// ───────────── Routes ─────────────

publicApi.get('/forms/:slug', rateLimit('public-read', 300, 60), async (c) => {
  const f = await loadPublishedForm(c, c.req.param('slug'));
  if (f.access === 'password' && !(await verifyAccess(c.env, f.formId, c.req.header('x-form-access') ?? c.req.query('access')))) {
    return c.json({ locked: 'password', form: { slug: f.slug, name: f.schema.form.title }, theme: f.schema.theme });
  }
  if (f.access === 'invite_only') {
    return c.json({ locked: 'invite_only', form: { slug: f.slug, name: f.schema.form.title }, theme: f.schema.theme, event: f.event });
  }
  c.header('cache-control', 'public, max-age=30');
  return c.json(publicPayload(f));
});

publicApi.post('/forms/:slug/unlock', rateLimit('unlock', 10, 600), async (c) => {
  const input = await body(c, z.object({ password: z.string().min(1).max(200) }));
  const row = await first<{ id: string; password_hash: string | null }>(c.env.DB, "SELECT id, password_hash FROM forms WHERE slug = ? AND deleted_at IS NULL AND access = 'password'", c.req.param('slug'));
  if (!row?.password_hash || !(await verifyPassword(input.password, row.password_hash))) throw new ApiError(401, 'invalid_password', 'Incorrect password');
  return c.json({ accessToken: await signAccess(c.env, row.id) });
});

publicApi.get('/events/:slug', rateLimit('public-read', 300, 60), async (c) => {
  const e = await first<{ id: string }>(c.env.DB, "SELECT id FROM events WHERE slug = ? AND deleted_at IS NULL AND status != 'draft'", c.req.param('slug'));
  if (!e) throw notFound('Event');
  const event = await loadPublicEvent(c.env.DB, e.id);
  const form = await first<{ slug: string; access: string }>(c.env.DB, `SELECT f.slug, f.access FROM event_forms ef JOIN forms f ON f.id = ef.form_id
    WHERE ef.event_id = ? AND f.deleted_at IS NULL AND f.published_version_id IS NOT NULL AND f.status = 'published' ORDER BY ef.is_primary DESC LIMIT 1`, e.id);
  return c.json({ event, form: form ? { slug: form.slug, inviteOnly: form.access === 'invite_only' } : null });
});

/** Personal invitation page data: event, form and guest prefill. Opening the link is tracked. */
publicApi.get('/invitations/:token', rateLimit('public-read', 300, 60), async (c) => {
  const inv = await loadInvitation(c.env.DB, c.req.param('token'));
  if (!inv) throw notFound('Invitation');
  await run(c.env.DB, 'UPDATE invitations SET opened_at = COALESCE(opened_at, ?) WHERE id = ?', nowIso(), inv.invitationId);
  const formRow = inv.formId
    ? await first<{ slug: string }>(c.env.DB, 'SELECT slug FROM forms WHERE id = ? AND deleted_at IS NULL', inv.formId)
    : await first<{ slug: string }>(c.env.DB, `SELECT f.slug FROM event_forms ef JOIN forms f ON f.id = ef.form_id WHERE ef.event_id = ? AND f.deleted_at IS NULL AND f.published_version_id IS NOT NULL ORDER BY ef.is_primary DESC LIMIT 1`, inv.eventId);
  const event = await loadPublicEvent(c.env.DB, inv.eventId);
  if (!event) throw notFound('Invitation');
  let formPayload: ReturnType<typeof publicPayload> | null = null;
  if (formRow) {
    try { formPayload = publicPayload(await loadPublishedForm(c, formRow.slug)); } catch { formPayload = null; }
  }
  const checkin = inv.rsvpStatus === 'accepted' || inv.rsvpStatus === 'maybe'
    ? await first<{ token: string }>(c.env.DB, "SELECT token FROM invitation_tokens WHERE invitation_id = ? AND purpose = 'checkin' AND revoked_at IS NULL", inv.invitationId)
    : null;
  const latest = await first<{ data: string }>(c.env.DB, 'SELECT s.data FROM event_guests eg JOIN submissions s ON s.id = eg.latest_submission_id WHERE eg.id = ? AND s.deleted_at IS NULL', inv.eventGuestId);
  c.header('cache-control', 'no-store');
  return c.json({
    guest: { name: inv.guest.name, email: inv.guest.email },
    rsvpStatus: inv.rsvpStatus,
    event,
    form: formPayload,
    previousAnswers: latest ? parseJson(latest.data, {}) : null,
    checkinToken: checkin?.token ?? null,
  });
});

publicApi.post('/forms/:slug/visits', rateLimit('visits', 120, 60), async (c) => {
  const input = await body(c, z.object({ device: z.enum(['desktop', 'mobile', 'tablet']).default('desktop') }));
  const f = await loadPublishedForm(c, c.req.param('slug'));
  const id = newId('vis');
  await run(c.env.DB, 'INSERT INTO form_visits (id, form_id, workspace_id, device) VALUES (?, ?, ?, ?)', id, f.formId, f.workspaceId, input.device);
  return c.json({ visitId: id }, 201);
});

publicApi.post('/visits/:visitId/start', rateLimit('visits', 120, 60), async (c) => {
  await run(c.env.DB, 'UPDATE form_visits SET started_at = COALESCE(started_at, ?) WHERE id = ?', nowIso(), c.req.param('visitId'));
  return c.json({ ok: true });
});

// ───────────── Uploads ─────────────

const MAGIC: { type: string; test: (b: Uint8Array) => boolean }[] = [
  { type: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { type: 'image/webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 },
  { type: 'application/pdf', test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

export function sniffType(bytes: Uint8Array): string | null {
  return MAGIC.find((m) => m.test(bytes))?.type ?? null;
}

function acceptMatches(accept: string[], type: string): boolean {
  return accept.some((a) => a === type || (a.endsWith('/*') && type.startsWith(a.slice(0, -1))));
}

publicApi.post('/forms/:slug/uploads', rateLimit('uploads', 30, 600), async (c) => {
  const f = await loadPublishedForm(c, c.req.param('slug'));
  if (closedState(f).closed) throw new ApiError(410, 'form_closed', 'This form is closed');
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  const fieldId = String(form?.get('fieldId') ?? '');
  const el = findElement(f.schema, fieldId);
  if (!el || el.type !== 'file_upload') throw new ApiError(422, 'validation_failed', 'Unknown upload field');
  if (!file || typeof file === 'string') throw new ApiError(422, 'validation_failed', 'No file provided');
  const upload = file as unknown as File;
  const maxBytes = (el.config.maxFileSizeMb ?? 10) * 1024 * 1024;
  if (upload.size <= 0 || upload.size > maxBytes) throw new ApiError(413, 'file_too_large', `Files must be under ${el.config.maxFileSizeMb ?? 10} MB`);
  const head = new Uint8Array(await upload.slice(0, 16).arrayBuffer());
  const detected = sniffType(head);
  // Verify the real content type from magic bytes rather than trusting the browser-provided type.
  if (!detected || !acceptMatches(el.config.accept ?? ['image/*', 'application/pdf'], detected)) {
    throw new ApiError(415, 'unsupported_file', 'This file type is not allowed');
  }
  const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
  const key = `uploads/${f.formId}/${newId('u', 20).slice(2)}/${safeName}`;
  await c.env.UPLOADS.put(key, upload.stream(), { httpMetadata: { contentType: detected, contentDisposition: `attachment; filename="${safeName}"` } });
  await run(c.env.DB, 'INSERT INTO uploads (id, workspace_id, form_id, key, name, size, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)', newId('upl'), f.workspaceId, f.formId, key, upload.name.slice(0, 200), upload.size, detected);
  return c.json({ key, name: upload.name.slice(0, 200), size: upload.size, type: detected } satisfies FileRef, 201);
});

// ───────────── Submissions ─────────────

const submissionInput = z.object({
  answers: z.record(z.unknown()),
  invitationToken: z.string().max(64).optional(),
  accessToken: z.string().max(200).optional(),
  visitId: z.string().max(40).optional(),
  idempotencyKey: z.string().min(8).max(64).optional(),
  query: z.record(z.string().max(500)).optional(),
  /** honeypot: real browsers leave this empty */
  website_url: z.string().max(500).optional(),
  startedAt: z.number().optional(),
  device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
});

function spamScore(input: z.infer<typeof submissionInput>, cleaned: Record<string, unknown>): number {
  let score = 0;
  if (input.website_url) score += 100;
  if (input.startedAt && Date.now() - input.startedAt < 1500) score += 50;
  const text = Object.values(cleaned).filter((v): v is string => typeof v === 'string').join(' ');
  const links = (text.match(/https?:\/\//g) ?? []).length;
  if (links > 3) score += 30;
  if (/\b(viagra|casino|crypto giveaway|seo services)\b/i.test(text)) score += 40;
  return score;
}

publicApi.post('/forms/:slug/submissions', rateLimit('submit', 30, 600), async (c) => {
  const input = await body(c, submissionInput, 1_500_000);
  const f = await loadPublishedForm(c, c.req.param('slug'));
  const db = c.env.DB;

  // Per-form throttle in addition to the per-IP limiter.
  const ipHash = await hashIp(clientIp(c), c.env.IP_HASH_SALT);
  if (!(await hit(db, `submit-form:${f.formId}:${ipHash}`, Math.round(10 * scale(c.env)), 600)).allowed) throw new ApiError(429, 'rate_limited', 'Too many submissions. Please try again later.');

  // Idempotent retries return the original result.
  if (input.idempotencyKey) {
    const existing = await first<{ id: string; data: string }>(db, 'SELECT id, data FROM submissions WHERE form_id = ? AND idempotency_key = ?', f.formId, input.idempotencyKey);
    if (existing) return c.json(await confirmationPayload(c, f, existing.id, parseJson(existing.data, {}), null), 200);
  }

  // Access control
  let invitation: InvitationContext | null = null;
  if (input.invitationToken) {
    invitation = await loadInvitation(db, input.invitationToken);
    if (!invitation || invitation.workspaceId !== f.workspaceId || (invitation.formId && invitation.formId !== f.formId) || (!invitation.formId && f.event?.id !== invitation.eventId)) {
      throw new ApiError(403, 'invalid_invitation', 'This invitation link is not valid for this form');
    }
  }
  if (f.access === 'invite_only' && !invitation) throw new ApiError(403, 'invite_only', 'This form is by invitation only');
  if (f.access === 'password' && !invitation && !(await verifyAccess(c.env, f.formId, input.accessToken))) throw new ApiError(401, 'password_required', 'This form is password protected');

  const state = closedState(f);
  if (state.closed) throw new ApiError(410, 'form_closed', f.closedMessage || 'This form is no longer accepting responses');

  const ent = await getEntitlements(db, f.workspaceId);
  if ((await usage(db, f.workspaceId, 'monthlySubmissions')) >= ent.limits.monthlySubmissions) {
    throw new ApiError(503, 'unavailable', 'This form is temporarily not accepting responses');
  }

  // Server-side validation is authoritative.
  const result = validateAnswers(f.schema, input.answers, { query: input.query });
  if (!result.ok) throw new ApiError(422, 'validation_failed', 'Please fix the highlighted fields', { fields: result.errors });
  const cleaned = result.cleaned;

  // Uploaded files must have been uploaded to this form and not yet attached.
  const fileKeys: string[] = [];
  for (const el of f.schema.pages.flatMap((p) => p.elements)) {
    if (el.type === 'file_upload' && Array.isArray(cleaned[el.id])) fileKeys.push(...(cleaned[el.id] as FileRef[]).map((x) => x.key));
  }
  for (const key of fileKeys) {
    const up = await first<{ submission_id: string | null }>(db, 'SELECT submission_id FROM uploads WHERE key = ? AND form_id = ?', key, f.formId);
    if (!up || up.submission_id) throw new ApiError(422, 'validation_failed', 'An uploaded file is invalid. Please upload it again.');
  }

  const outcome = deriveRsvp(f.schema, cleaned);
  const score = spamScore(input, cleaned);
  const isSpam = score >= 50;
  const dedupeKey = invitation ? `inv:${invitation.invitationId}` : outcome.email ? `email:${await sha256(outcome.email)}` : null;
  const prior = dedupeKey && !f.schema.settings.allowMultipleSubmissions
    ? await first<{ id: string }>(db, "SELECT id FROM submissions WHERE form_id = ? AND dedupe_key = ? AND deleted_at IS NULL AND status != 'spam' ORDER BY created_at DESC LIMIT 1", f.formId, dedupeKey)
    : null;

  // Event wiring (RSVP)
  const eventId = invitation?.eventId ?? f.event?.id ?? null;
  let eventGuestId = invitation?.eventGuestId ?? null;
  let guestId = invitation?.guestId ?? null;
  let sessions = { all: [] as string[], selected: [] as string[] };
  if (eventId && !isSpam) {
    if (!guestId && (outcome.name || outcome.email)) {
      guestId = await findOrCreateGuest(db, f.workspaceId, { name: outcome.name ?? outcome.email ?? 'Guest', email: outcome.email, phone: outcome.phone });
      eventGuestId = await ensureEventGuest(db, f.workspaceId, eventId, guestId);
    }
    sessions = await sessionsForOptions(db, eventId, outcome.sessionOptionIds);
    if (eventGuestId && (outcome.status === 'accepted' || outcome.status === 'maybe')) {
      await assertCapacity(db, eventId, eventGuestId, outcome.partySize, outcome.sessionOptionIds.length ? sessions.selected : []);
    }
  }

  const ts = nowIso();
  const meta = { device: input.device ?? 'desktop', userAgent: (c.req.header('user-agent') ?? '').slice(0, 200), version: f.version, spamScore: score };
  const answerStmts = (sid: string) => f.schema.pages.flatMap((p) => p.elements).filter((el) => FIELD_DEFINITIONS[el.type].isInput && cleaned[el.id] !== undefined).map((el) => {
    const v = cleaned[el.id];
    const num = typeof v === 'number' ? v : el.type === 'guest_count' ? outcome.partySize : null;
    return db.prepare('INSERT INTO answers (submission_id, form_id, field_id, field_type, value_text, value_number, value_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(submission_id, field_id) DO UPDATE SET value_text = excluded.value_text, value_number = excluded.value_number, value_json = excluded.value_json')
      .bind(sid, f.formId, el.id, el.type, answerIndexText(el, v), num, el.type === 'signature' ? null : JSON.stringify(v));
  });

  let submissionId: string;
  let edited = false;
  if (prior && invitation) {
    // Guests may update their RSVP through their personal link: edit in place and keep history.
    submissionId = prior.id;
    edited = true;
    await db.batch([
      db.prepare('UPDATE submissions SET form_version_id = ?, data = ?, meta = ?, rsvp_status = ?, party_size = ?, is_late = ?, respondent_name = ?, respondent_email = ?, updated_at = ? WHERE id = ?')
        .bind(f.versionId, JSON.stringify(cleaned), JSON.stringify(meta), outcome.status, outcome.partySize, state.late ? 1 : 0, outcome.name ?? invitation.guest.name, outcome.email ?? invitation.guest.email, ts, submissionId),
      db.prepare('DELETE FROM answers WHERE submission_id = ?').bind(submissionId),
      ...answerStmts(submissionId),
      db.prepare("INSERT INTO submission_events (id, submission_id, type, data) VALUES (?, ?, 'edited_by_respondent', ?)").bind(newId('sev'), submissionId, JSON.stringify({ version: f.version })),
    ]);
  } else {
    submissionId = newId('sub');
    try {
      await db.batch([
        db.prepare(`INSERT INTO submissions (id, workspace_id, form_id, form_version_id, event_id, invitation_id, guest_id, status, respondent_name, respondent_email, rsvp_status, party_size, is_late, dedupe_key, duplicate_of, spam_score, data, meta, ip_hash, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(submissionId, f.workspaceId, f.formId, f.versionId, eventId, invitation?.invitationId ?? null, guestId, isSpam ? 'spam' : 'complete',
            outcome.name ?? invitation?.guest.name ?? null, outcome.email ?? invitation?.guest.email ?? null, outcome.status, outcome.partySize, state.late ? 1 : 0,
            dedupeKey, prior?.id ?? null, score, JSON.stringify(cleaned), JSON.stringify(meta), ipHash, input.idempotencyKey ?? null, ts, ts),
        ...answerStmts(submissionId),
        db.prepare("INSERT INTO submission_events (id, submission_id, type, data) VALUES (?, ?, 'created', ?)").bind(newId('sev'), submissionId, JSON.stringify({ version: f.version, duplicateOf: prior?.id ?? null })),
      ]);
    } catch (e) {
      if (isUniqueViolation(e) && input.idempotencyKey) {
        const existing = await first<{ id: string; data: string }>(db, 'SELECT id, data FROM submissions WHERE form_id = ? AND idempotency_key = ?', f.formId, input.idempotencyKey);
        if (existing) return c.json(await confirmationPayload(c, f, existing.id, parseJson(existing.data, {}), null));
      }
      throw e;
    }
  }

  if (fileKeys.length) {
    await db.batch(fileKeys.map((k) => db.prepare('UPDATE uploads SET submission_id = ? WHERE key = ?').bind(submissionId, k)));
  }
  if (input.visitId) await run(db, 'UPDATE form_visits SET completed_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND form_id = ?', ts, ts, input.visitId, f.formId);

  if (isSpam) {
    // Respond as if successful so automated spammers get no signal.
    return c.json({ submissionId, confirmation: { title: f.schema.settings.confirmation.title.replace(/\{\{.*?\}\}/g, ''), message: f.schema.settings.confirmation.message }, event: null, checkinToken: null }, 201);
  }

  let checkinToken: string | null = null;
  if (eventId && eventGuestId) {
    if (outcome.status) {
      await applyRsvp(db, { eventId, eventGuestId, outcome, submissionId, selectedSessionIds: sessions.selected, allSessionIds: outcome.sessionOptionIds.length || f.schema.pages.some((p) => p.elements.some((e) => e.type === 'event_selection')) ? sessions.all : [] });
    } else {
      await run(db, 'UPDATE event_guests SET latest_submission_id = ?, updated_at = ? WHERE id = ?', submissionId, ts, eventGuestId);
    }
    const tokens = await ensureInvitation(db, f.workspaceId, eventId, eventGuestId, f.formId);
    if (!invitation) await run(db, 'UPDATE submissions SET invitation_id = ? WHERE id = ?', tokens.invitationId, submissionId);
    if (outcome.status === 'accepted' || outcome.status === 'maybe') checkinToken = tokens.checkinToken;
  }

  const payload = await confirmationPayload(c, f, submissionId, cleaned, checkinToken);

  // Notifications are queued, never sent inline.
  const respondentEmail = outcome.email ?? invitation?.guest.email ?? null;
  if (respondentEmail && (eventId || outcome.status)) {
    const type = outcome.status === 'declined' ? 'rsvp_decline' : 'rsvp_confirmation';
    await enqueueEmail(c.env, {
      workspaceId: f.workspaceId, type, to: respondentEmail,
      vars: {
        name: outcome.name ?? invitation?.guest.name ?? '', event: f.event?.name ?? f.schema.form.title, form: f.schema.form.title,
        date: f.event?.startsAt ?? '', venue: [f.event?.venueName, f.event?.address].filter(Boolean).join(', '),
        party_size: String(outcome.partySize), link: invitation ? `${c.env.APP_URL}/i/${input.invitationToken}` : `${c.env.APP_URL}/f/${f.slug}`,
        qr_link: checkinToken ? `${c.env.APP_URL}/api/v1/public/qr/${checkinToken}` : '',
      },
      idempotencyKey: `${type}:${submissionId}:${ts}`,
    }).catch(() => undefined);
  }
  await notifyOrganizer(c, f, submissionId, cleaned, edited).catch(() => undefined);
  await enqueueWebhooks(c.env, f.workspaceId, edited ? 'submission.updated' : 'submission.created', { formId: f.formId, formSlug: f.slug, submissionId, answers: cleaned, rsvpStatus: outcome.status, createdAt: ts }).catch(() => undefined);

  return c.json(payload, edited ? 200 : 201);
});

async function notifyOrganizer(c: Context<AppBindings>, f: PublicFormBase, submissionId: string, answers: Record<string, unknown>, edited: boolean) {
  const owner = await first<{ email: string; name: string }>(c.env.DB, 'SELECT u.email, u.name FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE w.id = ?', f.workspaceId);
  if (!owner) return;
  const summary = f.schema.pages.flatMap((p) => p.elements).filter((el) => answers[el.id] !== undefined && el.type !== 'signature').slice(0, 12)
    .map((el) => `${el.label || el.id}: ${formatAnswer(el, answers[el.id])}`).join('\n');
  await enqueueEmail(c.env, {
    workspaceId: f.workspaceId, type: 'organizer_notification', to: owner.email,
    vars: { name: owner.name, form: f.schema.form.title, summary, action: edited ? 'updated their response' : 'submitted a response', link: `${c.env.APP_URL}/responses/${submissionId}` },
    idempotencyKey: `org:${submissionId}:${edited ? nowIso() : 'new'}`,
  });
}

async function confirmationPayload(_c: Context<AppBindings>, f: PublicFormBase, submissionId: string, answers: Record<string, unknown>, checkinToken: string | null) {
  const conf = f.schema.settings.confirmation;
  const vars: Record<string, unknown> = {};
  for (const el of f.schema.pages.flatMap((p) => p.elements)) if (answers[el.id] !== undefined) vars[el.id] = formatAnswer(el, answers[el.id]);
  const declined = Object.entries(answers).some(([k, v]) => findElement(f.schema, k)?.type === 'attendance' && v === 'decline');
  return {
    submissionId,
    confirmation: {
      title: interpolate(conf.title, vars),
      message: interpolate(declined && conf.declineMessage ? conf.declineMessage : conf.message, vars),
      redirectUrl: conf.redirectUrl ?? null,
    },
    event: conf.showEventDetails ? f.event : null,
    checkinToken: conf.showQrCode && !declined ? checkinToken : null,
  };
}

/** QR code (SVG) encoding the check-in URL for a token. Only check-in tokens are rendered. */
publicApi.get('/qr/:token', rateLimit('public-read', 300, 60), async (c) => {
  const token = c.req.param('token');
  const row = /^[A-Za-z0-9_-]{16,64}$/.test(token)
    ? await first(c.env.DB, "SELECT 1 FROM invitation_tokens WHERE token = ? AND purpose = 'checkin' AND revoked_at IS NULL", token)
    : null;
  if (!row) throw notFound('QR code');
  const svg = renderSVG(`${c.env.APP_URL}/c/${token}`, { border: 2 });
  return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=3600' });
});
