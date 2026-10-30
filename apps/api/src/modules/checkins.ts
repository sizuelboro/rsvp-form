import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { newId } from '../lib/crypto';
import { all, first, isUniqueViolation, likeEscape, nowIso, run } from '../lib/db';
import { ApiError, body, notFound, query } from '../lib/http';
import { audit } from '../lib/audit';

export const checkins = new Hono<AppBindings>();

/** Accepts a raw token or a scanned URL such as https://app/c/<token>. */
export function extractToken(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/c\/([A-Za-z0-9_-]{16,64})(?:[?#].*)?$/) ?? s.match(/^([A-Za-z0-9_-]{16,64})$/);
  return m?.[1] ?? null;
}

interface GuestCard {
  event_guest_id: string; event_id: string; event_name: string; name: string; email: string | null; group_name: string | null;
  rsvp_status: string; party_size: number; adults: number; children: number; meal: string | null; dietary: string | null;
}

const CARD_SQL = `SELECT eg.id AS event_guest_id, eg.event_id, e.name AS event_name, g.name, g.email, gg.name AS group_name, eg.rsvp_status, eg.party_size, eg.adults, eg.children, eg.meal, eg.dietary
  FROM event_guests eg JOIN guests g ON g.id = eg.guest_id JOIN events e ON e.id = eg.event_id LEFT JOIN guest_groups gg ON gg.id = g.group_id`;

async function cardForToken(db: D1Database, wid: string, token: string): Promise<GuestCard | null> {
  return first<GuestCard>(db, `${CARD_SQL} JOIN invitations i ON i.event_guest_id = eg.id JOIN invitation_tokens t ON t.invitation_id = i.id
    WHERE t.token = ? AND t.purpose = 'checkin' AND t.revoked_at IS NULL AND eg.workspace_id = ? AND g.deleted_at IS NULL AND e.deleted_at IS NULL`, token, wid);
}

async function existingCheckins(db: D1Database, eventGuestId: string) {
  return all<{ id: string; session_id: string | null; created_at: string; method: string; checked_in_by_name: string | null }>(db, `SELECT ci.id, ci.session_id, ci.created_at, ci.method, u.name AS checked_in_by_name
    FROM checkins ci LEFT JOIN users u ON u.id = ci.checked_in_by WHERE ci.event_guest_id = ? AND ci.undone_at IS NULL ORDER BY ci.created_at`, eventGuestId);
}

/** Validate a scanned code without checking in (shows guest details first). */
checkins.post('/lookup', permission('checkin'), async (c) => {
  const input = await body(c, z.object({ code: z.string().min(1).max(500), eventId: z.string().max(40).optional() }));
  const token = extractToken(input.code);
  const card = token ? await cardForToken(c.env.DB, c.get('workspace').id, token) : null;
  if (!card) throw new ApiError(404, 'invalid_code', 'This QR code is not valid');
  if (input.eventId && card.event_id !== input.eventId) throw new ApiError(409, 'wrong_event', `This pass is for ${card.event_name}`);
  return c.json({ guest: card, checkins: await existingCheckins(c.env.DB, card.event_guest_id) });
});

const checkinInput = z.object({
  code: z.string().max(500).optional(),
  eventGuestId: z.string().max(40).optional(),
  eventId: z.string().max(40).optional(),
  sessionId: z.string().max(40).nullable().optional(),
  attendeeCount: z.number().int().min(1).max(100).optional(),
  /** Organizer override for declined/pending guests */
  override: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

checkins.post('/', permission('checkin'), async (c) => {
  const input = await body(c, checkinInput);
  const wid = c.get('workspace').id;
  const db = c.env.DB;
  let card: GuestCard | null = null;
  let method: 'qr' | 'manual' = 'manual';
  if (input.code) {
    const token = extractToken(input.code);
    card = token ? await cardForToken(db, wid, token) : null;
    method = 'qr';
    if (!card) throw new ApiError(404, 'invalid_code', 'This QR code is not valid');
  } else if (input.eventGuestId) {
    card = await first<GuestCard>(db, `${CARD_SQL} WHERE eg.id = ? AND eg.workspace_id = ? AND g.deleted_at IS NULL AND e.deleted_at IS NULL`, input.eventGuestId, wid);
    if (!card) throw notFound('Guest');
  } else {
    throw new ApiError(422, 'validation_failed', 'Provide a QR code or guest');
  }
  if (input.eventId && card.event_id !== input.eventId) throw new ApiError(409, 'wrong_event', `This pass is for ${card.event_name}`);
  if (input.sessionId && !(await first(db, 'SELECT 1 FROM event_sessions WHERE id = ? AND event_id = ? AND deleted_at IS NULL', input.sessionId, card.event_id))) throw notFound('Session');
  if (card.rsvp_status !== 'accepted' && card.rsvp_status !== 'maybe' && !input.override) {
    throw new ApiError(423, 'needs_override', card.rsvp_status === 'declined' ? `${card.name} declined this invitation` : `${card.name} has not RSVP’d yet`, { guest: card });
  }
  const id = newId('chk');
  try {
    await run(db, `INSERT INTO checkins (id, workspace_id, event_id, event_guest_id, session_id, method, is_override, note, checked_in_by, attendee_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, wid, card.event_id, card.event_guest_id, input.sessionId ?? null, method, input.override ? 1 : 0, input.note ?? null, c.get('user')!.id, input.attendeeCount ?? Math.max(1, card.party_size));
  } catch (e) {
    if (isUniqueViolation(e)) {
      const prior = (await existingCheckins(db, card.event_guest_id)).find((x) => (x.session_id ?? null) === (input.sessionId ?? null));
      throw new ApiError(409, 'already_checked_in', `${card.name} is already checked in`, { guest: card, checkin: prior });
    }
    throw e;
  }
  await audit(c, 'checkin.created', { type: 'checkin', id }, { eventGuestId: card.event_guest_id, method, override: input.override });
  return c.json({ id, guest: card, checkedInAt: nowIso() }, 201);
});

checkins.delete('/:checkinId', permission('checkin'), async (c) => {
  const res = await run(c.env.DB, 'UPDATE checkins SET undone_at = ?, undone_by = ? WHERE id = ? AND workspace_id = ? AND undone_at IS NULL', nowIso(), c.get('user')!.id, c.req.param('checkinId'), c.get('workspace').id);
  if (!res.meta.changes) throw notFound('Check-in');
  await audit(c, 'checkin.undone', { type: 'checkin', id: c.req.param('checkinId') });
  return c.json({ ok: true });
});

/** Manual check-in search: guests of an event with their check-in state. */
checkins.get('/events/:eventId', permission('checkin'), async (c) => {
  const q = query(c, z.object({ search: z.string().max(100).optional(), sessionId: z.string().max(40).optional() }));
  const wid = c.get('workspace').id;
  const ev = await first(c.env.DB, 'SELECT 1 FROM events WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', c.req.param('eventId'), wid);
  if (!ev) throw notFound('Event');
  const params: unknown[] = [q.sessionId ?? null, q.sessionId ?? null, c.req.param('eventId')];
  let where = 'eg.event_id = ? AND g.deleted_at IS NULL';
  if (q.search) { where += " AND (g.name LIKE ? ESCAPE '\\' OR g.email LIKE ? ESCAPE '\\')"; const s = likeEscape(q.search); params.push(s, s); }
  const items = await all(c.env.DB, `SELECT eg.id AS event_guest_id, g.name, g.email, gg.name AS group_name, eg.rsvp_status, eg.party_size,
      (SELECT ci.id FROM checkins ci WHERE ci.event_guest_id = eg.id AND ci.undone_at IS NULL AND IFNULL(ci.session_id,'') = IFNULL(?, '')) AS checkin_id,
      (SELECT ci.created_at FROM checkins ci WHERE ci.event_guest_id = eg.id AND ci.undone_at IS NULL AND IFNULL(ci.session_id,'') = IFNULL(?, '')) AS checked_in_at
    FROM event_guests eg JOIN guests g ON g.id = eg.guest_id LEFT JOIN guest_groups gg ON gg.id = g.group_id WHERE ${where}
    ORDER BY CASE eg.rsvp_status WHEN 'accepted' THEN 0 WHEN 'maybe' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, g.name COLLATE NOCASE LIMIT 200`, ...params);
  const stats = await first<{ expected: number; checked_in: number; attendees: number }>(c.env.DB, `SELECT
      (SELECT COALESCE(SUM(party_size),0) FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = ? AND rsvp_status = 'accepted') AS expected,
      (SELECT COUNT(*) FROM checkins WHERE event_id = ? AND undone_at IS NULL AND IFNULL(session_id,'') = IFNULL(?, '')) AS checked_in,
      (SELECT COALESCE(SUM(attendee_count),0) FROM checkins WHERE event_id = ? AND undone_at IS NULL AND IFNULL(session_id,'') = IFNULL(?, '')) AS attendees`,
    c.req.param('eventId'), c.req.param('eventId'), q.sessionId ?? null, c.req.param('eventId'), q.sessionId ?? null);
  return c.json({ items, stats });
});
