import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { newId, randomToken } from '../lib/crypto';
import { all, first, likeEscape, nowIso, run } from '../lib/db';
import { ApiError, body, notFound, query } from '../lib/http';
import { requireFeature, requireWithinLimit } from '../lib/entitlements';
import { audit } from '../lib/audit';
import { toCsv, csvResponse } from '../lib/csv';
import { formatEventDate } from '../lib/format';
import { ensureEventGuest, ensureInvitation, findOrCreateGuest } from '../services/rsvp';
import { enqueueEmail, type EmailType } from './notifications';
import { uniqueSlug } from './forms';
import { purgePublicFormCache } from './public';

export const events = new Hono<AppBindings>();

const isoOrNull = z.string().datetime({ offset: true }).nullable().optional();
const tz = z.string().max(64).refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Unknown time zone');

const eventInput = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/).optional(),
  description: z.string().max(10000).optional(),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
  timezone: tz.optional(),
  venueName: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  coverImage: z.string().url().max(2048).nullable().optional().or(z.literal('')),
  capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  rsvpDeadline: isoOrNull,
  status: z.enum(['draft', 'published', 'active', 'completed', 'cancelled']).optional(),
});

const toUtc = (v: string | null | undefined) => (v ? new Date(v).toISOString() : v ?? null);

interface EventRow { id: string; workspace_id: string; name: string; slug: string; status: string; starts_at: string | null; timezone: string; venue_name: string | null; address: string | null; rsvp_deadline: string | null; [k: string]: unknown }

export async function loadEvent(db: D1Database, wid: string, eventId: string): Promise<EventRow> {
  const e = await first<EventRow>(db, 'SELECT * FROM events WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', eventId, wid);
  if (!e) throw notFound('Event');
  return e;
}

const STATS_SQL = `
  (SELECT COUNT(*) FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = e.id) AS invited,
  (SELECT COUNT(*) FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = e.id AND eg.rsvp_status = 'accepted') AS accepted,
  (SELECT COUNT(*) FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = e.id AND eg.rsvp_status = 'declined') AS declined,
  (SELECT COUNT(*) FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = e.id AND eg.rsvp_status IN ('pending','maybe')) AS pending,
  (SELECT COALESCE(SUM(eg.party_size),0) FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = e.id AND eg.rsvp_status = 'accepted') AS expected_attendees,
  (SELECT COUNT(DISTINCT ci.event_guest_id) FROM checkins ci WHERE ci.event_id = e.id AND ci.undone_at IS NULL) AS checked_in`;

events.get('/', async (c) => {
  const q = query(c, z.object({ search: z.string().max(100).optional(), status: z.string().max(20).optional() }));
  const wid = c.get('workspace').id;
  const where = ['e.workspace_id = ?', 'e.deleted_at IS NULL'];
  const params: unknown[] = [wid];
  if (q.search) { where.push("e.name LIKE ? ESCAPE '\\'"); params.push(likeEscape(q.search)); }
  if (q.status) { where.push('e.status = ?'); params.push(q.status); }
  const items = await all(c.env.DB, `SELECT e.id, e.name, e.slug, e.status, e.starts_at, e.ends_at, e.timezone, e.venue_name, e.cover_image, e.capacity, e.rsvp_deadline, e.created_at, ${STATS_SQL}
    FROM events e WHERE ${where.join(' AND ')} ORDER BY COALESCE(e.starts_at, e.created_at) DESC LIMIT 200`, ...params);
  return c.json({ items });
});

events.post('/', permission('content.write'), async (c) => {
  const input = await body(c, eventInput);
  const wid = c.get('workspace').id;
  await requireWithinLimit(c.env.DB, wid, 'events');
  const id = newId('evt');
  const slug = input.slug ?? (await uniqueSlug(c.env.DB, 'events', input.name));
  if (input.slug && (await first(c.env.DB, 'SELECT 1 FROM events WHERE slug = ?', input.slug))) throw new ApiError(409, 'conflict', 'This event URL is already taken');
  await run(c.env.DB, `INSERT INTO events (id, workspace_id, name, slug, description, starts_at, ends_at, timezone, venue_name, address, cover_image, capacity, rsvp_deadline, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, wid, input.name, slug, input.description ?? '', toUtc(input.startsAt), toUtc(input.endsAt), input.timezone ?? 'UTC', input.venueName ?? null, input.address ?? null,
    input.coverImage || null, input.capacity ?? null, toUtc(input.rsvpDeadline), input.status ?? 'draft', c.get('user')!.id);
  await audit(c, 'event.created', { type: 'event', id }, { name: input.name });
  return c.json({ id, slug }, 201);
});

events.get('/:eventId', async (c) => {
  const wid = c.get('workspace').id;
  const e = await first(c.env.DB, `SELECT e.*, ${STATS_SQL} FROM events e WHERE e.id = ? AND e.workspace_id = ? AND e.deleted_at IS NULL`, c.req.param('eventId'), wid);
  if (!e) throw notFound('Event');
  const sessions = await all(c.env.DB, `SELECT s.*,
      (SELECT COUNT(*) FROM event_guest_sessions egs WHERE egs.session_id = s.id AND egs.rsvp_status = 'accepted') AS accepted,
      (SELECT COALESCE(SUM(eg.party_size),0) FROM event_guest_sessions egs JOIN event_guests eg ON eg.id = egs.event_guest_id WHERE egs.session_id = s.id AND egs.rsvp_status = 'accepted') AS expected_attendees,
      (SELECT COUNT(*) FROM checkins ci WHERE ci.session_id = s.id AND ci.undone_at IS NULL) AS checked_in
    FROM event_sessions s WHERE s.event_id = ? AND s.deleted_at IS NULL ORDER BY s.sort_order, s.starts_at`, c.req.param('eventId'));
  const formsList = await all(c.env.DB, `SELECT f.id, f.name, f.slug, f.status, f.access, ef.is_primary,
      (SELECT COUNT(*) FROM submissions s WHERE s.form_id = f.id AND s.deleted_at IS NULL AND s.status != 'spam') AS responses
    FROM event_forms ef JOIN forms f ON f.id = ef.form_id WHERE ef.event_id = ? AND f.deleted_at IS NULL ORDER BY ef.is_primary DESC, f.name`, c.req.param('eventId'));
  return c.json({ ...e, sessions, forms: formsList });
});

events.patch('/:eventId', permission('content.write'), async (c) => {
  const input = await body(c, eventInput.partial());
  const wid = c.get('workspace').id;
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  const map: Record<string, [string, unknown]> = {
    name: ['name', input.name], description: ['description', input.description], startsAt: ['starts_at', toUtc(input.startsAt)], endsAt: ['ends_at', toUtc(input.endsAt)],
    timezone: ['timezone', input.timezone], venueName: ['venue_name', input.venueName], address: ['address', input.address], coverImage: ['cover_image', input.coverImage || null],
    capacity: ['capacity', input.capacity], rsvpDeadline: ['rsvp_deadline', toUtc(input.rsvpDeadline)], status: ['status', input.status], slug: ['slug', input.slug],
  };
  if (input.slug && input.slug !== e.slug && (await first(c.env.DB, 'SELECT 1 FROM events WHERE slug = ? AND id != ?', input.slug, e.id))) throw new ApiError(409, 'conflict', 'This event URL is already taken');
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, [col, val]] of Object.entries(map)) {
    if ((input as Record<string, unknown>)[k] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(val);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(nowIso());
    await run(c.env.DB, `UPDATE events SET ${sets.join(', ')} WHERE id = ?`, ...params, e.id);
    // Event details are embedded in cached public form payloads.
    const linked = await all<{ slug: string }>(c.env.DB, 'SELECT f.slug FROM event_forms ef JOIN forms f ON f.id = ef.form_id WHERE ef.event_id = ?', e.id);
    for (const l of linked) await purgePublicFormCache(c, l.slug);
    await audit(c, 'event.updated', { type: 'event', id: e.id }, input);
  }
  return c.json({ ok: true });
});

events.delete('/:eventId', permission('content.write'), async (c) => {
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  await run(c.env.DB, "UPDATE events SET deleted_at = ?, slug = slug || '--deleted-' || substr(id, 5) WHERE id = ?", nowIso(), e.id);
  await audit(c, 'event.deleted', { type: 'event', id: e.id }, { name: e.name });
  return c.json({ ok: true });
});

// ─── Sessions ───
const sessionInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  startsAt: isoOrNull, endsAt: isoOrNull,
  venueName: z.string().max(200).nullable().optional(), address: z.string().max(500).nullable().optional(),
  capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  formId: z.string().max(40).nullable().optional(),
  optionId: z.string().max(64).regex(/^[a-z][a-z0-9_]*$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

events.post('/:eventId/sessions', permission('content.write'), async (c) => {
  const input = await body(c, sessionInput);
  const wid = c.get('workspace').id;
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  if (input.formId && !(await first(c.env.DB, 'SELECT 1 FROM forms WHERE id = ? AND workspace_id = ?', input.formId, wid))) throw notFound('Form');
  const id = newId('ses');
  const order = input.sortOrder ?? ((await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM event_sessions WHERE event_id = ?', e.id))?.n ?? 0);
  const optionId = input.optionId ?? (input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^(\d)/, 'o_$1') || null);
  await run(c.env.DB, `INSERT INTO event_sessions (id, event_id, workspace_id, name, description, starts_at, ends_at, venue_name, address, capacity, form_id, option_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, e.id, wid, input.name, input.description ?? '', toUtc(input.startsAt), toUtc(input.endsAt), input.venueName ?? null, input.address ?? null, input.capacity ?? null, input.formId ?? null, optionId, order);
  return c.json({ id }, 201);
});

events.patch('/:eventId/sessions/:sessionId', permission('content.write'), async (c) => {
  const input = await body(c, sessionInput.partial());
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const cols: Record<string, string> = { name: 'name', description: 'description', startsAt: 'starts_at', endsAt: 'ends_at', venueName: 'venue_name', address: 'address', capacity: 'capacity', formId: 'form_id', optionId: 'option_id', sortOrder: 'sort_order' };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(cols)) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(k === 'startsAt' || k === 'endsAt' ? toUtc(v as string | null) : v);
  }
  if (!sets.length) return c.json({ ok: true });
  const res = await run(c.env.DB, `UPDATE event_sessions SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND event_id = ?`, ...params, nowIso(), c.req.param('sessionId'), e.id);
  if (!res.meta.changes) throw notFound('Session');
  return c.json({ ok: true });
});

events.delete('/:eventId/sessions/:sessionId', permission('content.write'), async (c) => {
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  await run(c.env.DB, 'UPDATE event_sessions SET deleted_at = ? WHERE id = ? AND event_id = ?', nowIso(), c.req.param('sessionId'), e.id);
  return c.json({ ok: true });
});

// ─── Forms assigned to an event ───
events.post('/:eventId/forms', permission('content.write'), async (c) => {
  const input = await body(c, z.object({ formId: z.string().max(40), isPrimary: z.boolean().optional() }));
  const wid = c.get('workspace').id;
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  const f = await first<{ slug: string }>(c.env.DB, 'SELECT slug FROM forms WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', input.formId, wid);
  if (!f) throw notFound('Form');
  const hasPrimary = await first(c.env.DB, 'SELECT 1 FROM event_forms WHERE event_id = ? AND is_primary = 1', e.id);
  const primary = input.isPrimary || !hasPrimary;
  const stmts = [];
  if (primary) stmts.push(c.env.DB.prepare('UPDATE event_forms SET is_primary = 0 WHERE event_id = ?').bind(e.id));
  stmts.push(c.env.DB.prepare('INSERT INTO event_forms (event_id, form_id, is_primary) VALUES (?, ?, ?) ON CONFLICT(event_id, form_id) DO UPDATE SET is_primary = excluded.is_primary').bind(e.id, input.formId, primary ? 1 : 0));
  stmts.push(c.env.DB.prepare("UPDATE forms SET kind = 'rsvp' WHERE id = ?").bind(input.formId));
  await c.env.DB.batch(stmts);
  await purgePublicFormCache(c, f.slug);
  return c.json({ ok: true });
});

events.delete('/:eventId/forms/:formId', permission('content.write'), async (c) => {
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  await run(c.env.DB, 'DELETE FROM event_forms WHERE event_id = ? AND form_id = ?', e.id, c.req.param('formId'));
  return c.json({ ok: true });
});

// ─── Event guests ───
const guestListQuery = z.object({
  search: z.string().max(100).optional(),
  rsvp: z.enum(['pending', 'accepted', 'declined', 'maybe']).optional(),
  invitation: z.enum(['none', 'draft', 'queued', 'sent', 'delivered', 'failed']).optional(),
  checkedIn: z.enum(['yes', 'no']).optional(),
  groupId: z.string().max(40).optional(),
  sort: z.enum(['name', 'rsvp_at', 'party_size', 'created_at']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

function eventGuestWhere(eventId: string, q: z.infer<typeof guestListQuery>) {
  const where = ['eg.event_id = ?', 'g.deleted_at IS NULL'];
  const params: unknown[] = [eventId];
  if (q.search) { where.push("(g.name LIKE ? ESCAPE '\\' OR g.email LIKE ? ESCAPE '\\' OR g.phone LIKE ? ESCAPE '\\')"); const s = likeEscape(q.search); params.push(s, s, s); }
  if (q.rsvp) { where.push('eg.rsvp_status = ?'); params.push(q.rsvp); }
  if (q.invitation === 'none') where.push('i.id IS NULL');
  else if (q.invitation) { where.push('i.status = ?'); params.push(q.invitation); }
  if (q.checkedIn === 'yes') where.push('EXISTS (SELECT 1 FROM checkins ci WHERE ci.event_guest_id = eg.id AND ci.undone_at IS NULL)');
  if (q.checkedIn === 'no') where.push('NOT EXISTS (SELECT 1 FROM checkins ci WHERE ci.event_guest_id = eg.id AND ci.undone_at IS NULL)');
  if (q.groupId) { where.push('g.group_id = ?'); params.push(q.groupId); }
  return { where: where.join(' AND '), params };
}

const EVENT_GUEST_SELECT = `SELECT eg.id, eg.guest_id, g.name, g.email, g.phone, gg.name AS group_name, h.name AS household_name, eg.rsvp_status, eg.rsvp_at, eg.party_size, eg.adults, eg.children,
  eg.meal, eg.dietary, eg.plus_ones_allowed, eg.created_at, i.id AS invitation_id, i.status AS invitation_status, i.sent_at, i.opened_at, i.last_error,
  (SELECT MIN(ci.created_at) FROM checkins ci WHERE ci.event_guest_id = eg.id AND ci.undone_at IS NULL) AS checked_in_at,
  (SELECT t.token FROM invitation_tokens t WHERE t.invitation_id = i.id AND t.purpose = 'rsvp' AND t.revoked_at IS NULL) AS rsvp_token
  FROM event_guests eg JOIN guests g ON g.id = eg.guest_id LEFT JOIN guest_groups gg ON gg.id = g.group_id LEFT JOIN households h ON h.id = g.household_id LEFT JOIN invitations i ON i.event_guest_id = eg.id`;

events.get('/:eventId/guests', async (c) => {
  const q = query(c, guestListQuery);
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const { where, params } = eventGuestWhere(e.id, q);
  const sortCol = { name: 'g.name COLLATE NOCASE', rsvp_at: 'eg.rsvp_at', party_size: 'eg.party_size', created_at: 'eg.created_at' }[q.sort];
  const total = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM event_guests eg JOIN guests g ON g.id = eg.guest_id LEFT JOIN invitations i ON i.event_guest_id = eg.id WHERE ${where}`, ...params);
  const items = await all<Record<string, unknown>>(c.env.DB, `${EVENT_GUEST_SELECT} WHERE ${where} ORDER BY ${sortCol} ${q.dir.toUpperCase()}, eg.id LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return c.json({
    items: items.map(({ rsvp_token, ...r }) => ({ ...r, rsvpUrl: rsvp_token ? `${c.env.APP_URL}/i/${rsvp_token}` : null })),
    total: total?.n ?? 0, page: q.page, pageSize: q.pageSize,
  });
});

events.post('/:eventId/guests', permission('content.write'), async (c) => {
  const input = await body(c, z.object({
    guestIds: z.array(z.string().max(40)).max(1000).optional(),
    guests: z.array(z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254).optional().or(z.literal('')), phone: z.string().max(40).optional() })).max(1000).optional(),
    plusOnesAllowed: z.number().int().min(0).max(20).optional(),
  }));
  const wid = c.get('workspace').id;
  await requireFeature(c.env.DB, wid, 'guestManagement');
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  const ids: string[] = [];
  for (const gid of input.guestIds ?? []) {
    if (await first(c.env.DB, 'SELECT 1 FROM guests WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', gid, wid)) ids.push(gid);
  }
  if (input.guests?.length) await requireWithinLimit(c.env.DB, wid, 'guests', input.guests.length);
  for (const g of input.guests ?? []) ids.push(await findOrCreateGuest(c.env.DB, wid, g));
  let added = 0;
  for (const gid of new Set(ids)) {
    const existed = await first(c.env.DB, 'SELECT 1 FROM event_guests WHERE event_id = ? AND guest_id = ?', e.id, gid);
    const egId = await ensureEventGuest(c.env.DB, wid, e.id, gid);
    if (input.plusOnesAllowed !== undefined) await run(c.env.DB, 'UPDATE event_guests SET plus_ones_allowed = ? WHERE id = ?', input.plusOnesAllowed, egId);
    if (!existed) added++;
  }
  await audit(c, 'event.guests_added', { type: 'event', id: e.id }, { added });
  return c.json({ added, total: ids.length }, 201);
});

/** Organizer override: set RSVP manually (e.g. phone RSVPs or late changes after the deadline). */
events.patch('/:eventId/guests/:eventGuestId', permission('content.write'), async (c) => {
  const input = await body(c, z.object({
    rsvpStatus: z.enum(['pending', 'accepted', 'declined', 'maybe']).optional(),
    partySize: z.number().int().min(0).max(100).optional(),
    adults: z.number().int().min(0).max(100).optional(),
    children: z.number().int().min(0).max(100).optional(),
    meal: z.string().max(100).nullable().optional(),
    dietary: z.string().max(500).nullable().optional(),
    plusOnesAllowed: z.number().int().min(0).max(20).optional(),
  }));
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const eg = await first<{ id: string; party_size: number }>(c.env.DB, 'SELECT id, party_size FROM event_guests WHERE id = ? AND event_id = ?', c.req.param('eventGuestId'), e.id);
  if (!eg) throw notFound('Guest');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.rsvpStatus) {
    sets.push('rsvp_status = ?', 'rsvp_at = ?'); params.push(input.rsvpStatus, nowIso());
    if (input.rsvpStatus === 'declined' || input.rsvpStatus === 'pending') { sets.push('party_size = 0', 'adults = 0', 'children = 0'); }
    else if (input.partySize === undefined && eg.party_size === 0) { sets.push('party_size = 1', 'adults = 1'); }
  }
  const nums: [keyof typeof input, string][] = [['partySize', 'party_size'], ['adults', 'adults'], ['children', 'children'], ['meal', 'meal'], ['dietary', 'dietary'], ['plusOnesAllowed', 'plus_ones_allowed']];
  for (const [k, col] of nums) if (input[k] !== undefined) { sets.push(`${col} = ?`); params.push(input[k]); }
  if (!sets.length) return c.json({ ok: true });
  await run(c.env.DB, `UPDATE event_guests SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), eg.id);
  await audit(c, 'event_guest.overridden', { type: 'event_guest', id: eg.id }, input);
  return c.json({ ok: true });
});

events.post('/:eventId/guests/remove', permission('content.write'), async (c) => {
  const input = await body(c, z.object({ eventGuestIds: z.array(z.string().max(40)).min(1).max(1000) }));
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  await c.env.DB.batch(input.eventGuestIds.map((id) => c.env.DB.prepare('DELETE FROM event_guests WHERE id = ? AND event_id = ?').bind(id, e.id)));
  return c.json({ removed: input.eventGuestIds.length });
});

events.get('/:eventId/guests/:eventGuestId/sessions', async (c) => {
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const items = await all(c.env.DB, `SELECT s.id, s.name, COALESCE(egs.rsvp_status, 'pending') AS rsvp_status,
    EXISTS (SELECT 1 FROM checkins ci WHERE ci.event_guest_id = ? AND ci.session_id = s.id AND ci.undone_at IS NULL) AS checked_in
    FROM event_sessions s LEFT JOIN event_guest_sessions egs ON egs.session_id = s.id AND egs.event_guest_id = ? WHERE s.event_id = ? AND s.deleted_at IS NULL ORDER BY s.sort_order`,
    c.req.param('eventGuestId'), c.req.param('eventGuestId'), e.id);
  return c.json({ items });
});

events.put('/:eventId/guests/:eventGuestId/sessions/:sessionId', permission('content.write'), async (c) => {
  const input = await body(c, z.object({ rsvpStatus: z.enum(['pending', 'accepted', 'declined', 'maybe']) }));
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const ok = await first(c.env.DB, 'SELECT 1 FROM event_guests eg JOIN event_sessions s ON s.event_id = eg.event_id WHERE eg.id = ? AND s.id = ? AND eg.event_id = ?', c.req.param('eventGuestId'), c.req.param('sessionId'), e.id);
  if (!ok) throw notFound('Session');
  await run(c.env.DB, `INSERT INTO event_guest_sessions (event_guest_id, session_id, rsvp_status) VALUES (?, ?, ?) ON CONFLICT(event_guest_id, session_id) DO UPDATE SET rsvp_status = excluded.rsvp_status`, c.req.param('eventGuestId'), c.req.param('sessionId'), input.rsvpStatus);
  return c.json({ ok: true });
});

// ─── Invitations ───

async function primaryFormId(db: D1Database, eventId: string): Promise<string | null> {
  return (await first<{ form_id: string }>(db, 'SELECT ef.form_id FROM event_forms ef JOIN forms f ON f.id = ef.form_id WHERE ef.event_id = ? AND f.deleted_at IS NULL ORDER BY ef.is_primary DESC LIMIT 1', eventId))?.form_id ?? null;
}

/** Step 1: create invitation links (no email is sent). Returns a preview for the confirmation dialog. */
events.post('/:eventId/invitations/prepare', permission('invitations.send'), async (c) => {
  const input = await body(c, z.object({ eventGuestIds: z.array(z.string().max(40)).max(5000).optional(), audience: z.enum(['selected', 'not_sent', 'pending', 'all']).default('selected') }));
  const wid = c.get('workspace').id;
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  const formId = await primaryFormId(c.env.DB, e.id);
  if (!formId) throw new ApiError(422, 'no_form', 'Assign an RSVP form to this event before creating invitations');
  const form = await first<{ published_version_id: string | null }>(c.env.DB, 'SELECT published_version_id FROM forms WHERE id = ?', formId);
  const targets = await resolveAudience(c.env.DB, e.id, input.audience, input.eventGuestIds);
  for (const t of targets) await ensureInvitation(c.env.DB, wid, e.id, t.id, formId);
  const withEmail = targets.filter((t) => t.email);
  const suppressed = withEmail.length ? (await all<{ email: string }>(c.env.DB, `SELECT email FROM email_suppressions WHERE workspace_id = ?`, wid)).map((s) => s.email.toLowerCase()) : [];
  const sample = withEmail[0];
  return c.json({
    total: targets.length,
    withEmail: withEmail.filter((t) => !suppressed.includes(t.email!.toLowerCase())).length,
    withoutEmail: targets.length - withEmail.length,
    suppressed: withEmail.filter((t) => suppressed.includes(t.email!.toLowerCase())).length,
    formPublished: Boolean(form?.published_version_id),
    eventGuestIds: targets.map((t) => t.id),
    sample: sample ? { to: sample.email, name: sample.name } : null,
  });
});

async function resolveAudience(db: D1Database, eventId: string, audience: string, ids?: string[]) {
  const base = `SELECT eg.id, g.name, g.email, i.status AS invitation_status, eg.rsvp_status FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL LEFT JOIN invitations i ON i.event_guest_id = eg.id WHERE eg.event_id = ?`;
  const rows = await all<{ id: string; name: string; email: string | null; invitation_status: string | null; rsvp_status: string }>(db, base, eventId);
  if (audience === 'selected') return rows.filter((r) => ids?.includes(r.id));
  if (audience === 'not_sent') return rows.filter((r) => !r.invitation_status || r.invitation_status === 'draft' || r.invitation_status === 'failed');
  if (audience === 'pending') return rows.filter((r) => r.rsvp_status === 'pending' || r.rsvp_status === 'maybe');
  return rows;
}

const sendInput = z.object({
  eventGuestIds: z.array(z.string().max(40)).min(1).max(5000),
  /** Explicit organizer confirmation is required. Nothing is ever sent automatically. */
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm sending before emails are queued' }) }),
  kind: z.enum(['invitation', 'deadline_reminder', 'event_reminder']).default('invitation'),
});

events.post('/:eventId/invitations/send', permission('invitations.send'), async (c) => {
  const input = await body(c, sendInput);
  const wid = c.get('workspace').id;
  await requireFeature(c.env.DB, wid, 'emailInvitations');
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  if (e.status === 'draft') throw new ApiError(422, 'event_draft', 'Publish the event before sending invitations');
  const formId = await primaryFormId(c.env.DB, e.id);
  if (!formId) throw new ApiError(422, 'no_form', 'Assign an RSVP form to this event first');
  const form = await first<{ published_version_id: string | null }>(c.env.DB, 'SELECT published_version_id FROM forms WHERE id = ?', formId);
  if (!form?.published_version_id) throw new ApiError(422, 'form_unpublished', 'Publish the RSVP form before sending invitations');

  let queued = 0, skipped = 0, suppressed = 0;
  const deadlineText = e.rsvp_deadline ? ` by ${formatEventDate(e.rsvp_deadline, e.timezone)}` : '';
  for (const egId of new Set(input.eventGuestIds)) {
    const g = await first<{ name: string; email: string | null }>(c.env.DB, 'SELECT g.name, g.email FROM event_guests eg JOIN guests g ON g.id = eg.guest_id WHERE eg.id = ? AND eg.event_id = ? AND g.deleted_at IS NULL', egId, e.id);
    if (!g?.email) { skipped++; continue; }
    const tokens = await ensureInvitation(c.env.DB, wid, e.id, egId, formId);
    const res = await enqueueEmail(c.env, {
      workspaceId: wid, type: input.kind as EmailType, to: g.email, invitationId: input.kind === 'invitation' ? tokens.invitationId : undefined,
      vars: { name: g.name, event: e.name, date: formatEventDate(e.starts_at, e.timezone), venue: [e.venue_name, e.address].filter(Boolean).join(', '), deadline_text: deadlineText, link: `${c.env.APP_URL}/i/${tokens.rsvpToken}` },
      idempotencyKey: `${input.kind}:${tokens.invitationId}:${randomToken(6)}`,
    });
    if (res.suppressed) { suppressed++; continue; }
    if (input.kind === 'invitation') await run(c.env.DB, "UPDATE invitations SET status = 'queued', updated_at = ? WHERE id = ? AND status IN ('draft','failed','queued')", nowIso(), tokens.invitationId);
    queued++;
  }
  await audit(c, `event.${input.kind}_sent`, { type: 'event', id: e.id }, { queued, skipped, suppressed });
  return c.json({ queued, skipped, suppressed });
});

/** Broadcast an update or cancellation notice to everyone who has not declined. */
events.post('/:eventId/broadcast', permission('invitations.send'), async (c) => {
  const input = await body(c, z.object({ kind: z.enum(['event_update', 'cancellation']), message: z.string().trim().min(1).max(5000), confirm: z.literal(true) }));
  const wid = c.get('workspace').id;
  await requireFeature(c.env.DB, wid, 'emailInvitations');
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  const recipients = await all<{ id: string; name: string; email: string }>(c.env.DB, `SELECT eg.id, g.name, g.email FROM event_guests eg JOIN guests g ON g.id = eg.guest_id
    WHERE eg.event_id = ? AND g.deleted_at IS NULL AND g.email IS NOT NULL AND eg.rsvp_status != 'declined'`, e.id);
  const batchKey = randomToken(6);
  let queued = 0;
  for (const r of recipients) {
    const tokens = await ensureInvitation(c.env.DB, wid, e.id, r.id, await primaryFormId(c.env.DB, e.id));
    const res = await enqueueEmail(c.env, { workspaceId: wid, type: input.kind, to: r.email, vars: { name: r.name, event: e.name, message: input.message, date: formatEventDate(e.starts_at, e.timezone), venue: [e.venue_name, e.address].filter(Boolean).join(', '), link: `${c.env.APP_URL}/i/${tokens.rsvpToken}` }, idempotencyKey: `${input.kind}:${r.id}:${batchKey}` });
    if (!res.suppressed) queued++;
  }
  if (input.kind === 'cancellation') await run(c.env.DB, "UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), e.id);
  await audit(c, `event.${input.kind}`, { type: 'event', id: e.id }, { queued });
  return c.json({ queued });
});

// ─── Reports ───
events.get('/:eventId/export', async (c) => {
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const rows = await all<Record<string, string | number | null>>(c.env.DB, `${EVENT_GUEST_SELECT} WHERE eg.event_id = ? AND g.deleted_at IS NULL ORDER BY g.name COLLATE NOCASE`, e.id);
  const csv = toCsv([
    ['Name', 'Email', 'Phone', 'Group', 'Household', 'Invitation', 'RSVP', 'Responded at', 'Party size', 'Adults', 'Children', 'Meal', 'Dietary', 'Checked in at', 'RSVP link'],
    ...rows.map((r) => [r.name, r.email, r.phone, r.group_name, r.household_name, r.invitation_status ?? 'not created', r.rsvp_status, r.rsvp_at, r.party_size, r.adults, r.children, r.meal, r.dietary, r.checked_in_at, r.rsvp_token ? `${c.env.APP_URL}/i/${r.rsvp_token}` : '']),
  ]);
  return csvResponse(`${e.slug}-guests.csv`, csv);
});
