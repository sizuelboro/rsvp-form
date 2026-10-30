import type { RsvpOutcome } from '@rsvp/core';
import { newId, randomToken } from '../lib/crypto';
import { all, first, nowIso } from '../lib/db';
import { ApiError } from '../lib/http';

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const d = phone?.replace(/[^\d+]/g, '');
  return d && d.replace(/\D/g, '').length >= 7 ? d : null;
}

/** Find a guest by email (preferred) or exact name+phone; create one otherwise. Guests are reused across events. */
export async function findOrCreateGuest(db: D1Database, workspaceId: string, g: { name: string; email?: string | null; phone?: string | null }): Promise<string> {
  const email = normalizeEmail(g.email);
  const phone = normalizePhone(g.phone);
  if (email) {
    const existing = await first<{ id: string }>(db, 'SELECT id FROM guests WHERE workspace_id = ? AND email_normalized = ? AND deleted_at IS NULL', workspaceId, email);
    if (existing) return existing.id;
  } else if (phone) {
    const existing = await first<{ id: string }>(db, 'SELECT id FROM guests WHERE workspace_id = ? AND phone_normalized = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL', workspaceId, phone, g.name);
    if (existing) return existing.id;
  }
  const id = newId('gst');
  await db.prepare('INSERT INTO guests (id, workspace_id, name, email, email_normalized, phone, phone_normalized) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, workspaceId, g.name.slice(0, 200), g.email?.trim() || null, email, g.phone?.trim() || null, phone).run();
  return id;
}

export async function ensureEventGuest(db: D1Database, workspaceId: string, eventId: string, guestId: string): Promise<string> {
  const existing = await first<{ id: string }>(db, 'SELECT id FROM event_guests WHERE event_id = ? AND guest_id = ?', eventId, guestId);
  if (existing) return existing.id;
  const id = newId('eg');
  await db.prepare('INSERT INTO event_guests (id, workspace_id, event_id, guest_id) VALUES (?, ?, ?, ?) ON CONFLICT(event_id, guest_id) DO NOTHING').bind(id, workspaceId, eventId, guestId).run();
  return (await first<{ id: string }>(db, 'SELECT id FROM event_guests WHERE event_id = ? AND guest_id = ?', eventId, guestId))!.id;
}

/** Ensures an invitation row plus RSVP and check-in tokens exist for an event guest. */
export async function ensureInvitation(db: D1Database, workspaceId: string, eventId: string, eventGuestId: string, formId: string | null): Promise<{ invitationId: string; rsvpToken: string; checkinToken: string }> {
  let inv = await first<{ id: string }>(db, 'SELECT id FROM invitations WHERE event_guest_id = ?', eventGuestId);
  if (!inv) {
    const id = newId('inv');
    await db.prepare('INSERT INTO invitations (id, workspace_id, event_id, event_guest_id, form_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_guest_id) DO NOTHING').bind(id, workspaceId, eventId, eventGuestId, formId).run();
    inv = await first<{ id: string }>(db, 'SELECT id FROM invitations WHERE event_guest_id = ?', eventGuestId);
  } else if (formId) {
    await db.prepare('UPDATE invitations SET form_id = COALESCE(form_id, ?) WHERE id = ?').bind(formId, inv.id).run();
  }
  const invitationId = inv!.id;
  const tokens = await all<{ token: string; purpose: string }>(db, 'SELECT token, purpose FROM invitation_tokens WHERE invitation_id = ? AND revoked_at IS NULL', invitationId);
  let rsvpToken = tokens.find((t) => t.purpose === 'rsvp')?.token;
  let checkinToken = tokens.find((t) => t.purpose === 'checkin')?.token;
  if (!rsvpToken) {
    rsvpToken = randomToken(18);
    await db.prepare("INSERT INTO invitation_tokens (token, invitation_id, purpose) VALUES (?, ?, 'rsvp')").bind(rsvpToken, invitationId).run();
  }
  if (!checkinToken) {
    checkinToken = randomToken(18);
    await db.prepare("INSERT INTO invitation_tokens (token, invitation_id, purpose) VALUES (?, ?, 'checkin')").bind(checkinToken, invitationId).run();
  }
  return { invitationId, rsvpToken, checkinToken };
}

interface CapacityRow { capacity: number | null }

/** Enforce event and session capacity for an acceptance. */
export async function assertCapacity(db: D1Database, eventId: string, eventGuestId: string | null, partySize: number, sessionIds: string[]): Promise<void> {
  if (partySize <= 0) return;
  const ev = await first<CapacityRow>(db, 'SELECT capacity FROM events WHERE id = ?', eventId);
  if (ev?.capacity) {
    const used = await first<{ n: number }>(db, "SELECT COALESCE(SUM(party_size), 0) AS n FROM event_guests WHERE event_id = ? AND rsvp_status IN ('accepted','maybe') AND id != ?", eventId, eventGuestId ?? '');
    if ((used?.n ?? 0) + partySize > ev.capacity) throw new ApiError(409, 'event_full', 'Sorry, this event is at capacity');
  }
  for (const sid of sessionIds) {
    const s = await first<CapacityRow & { name: string }>(db, 'SELECT capacity, name FROM event_sessions WHERE id = ?', sid);
    if (!s?.capacity) continue;
    const used = await first<{ n: number }>(db, `SELECT COALESCE(SUM(eg.party_size), 0) AS n FROM event_guest_sessions egs JOIN event_guests eg ON eg.id = egs.event_guest_id
      WHERE egs.session_id = ? AND egs.rsvp_status = 'accepted' AND eg.id != ?`, sid, eventGuestId ?? '');
    if ((used?.n ?? 0) + partySize > s.capacity) throw new ApiError(409, 'session_full', `Sorry, ${s.name} is at capacity`);
  }
}

/** Map event_selection option ids to session ids for an event. */
export async function sessionsForOptions(db: D1Database, eventId: string, optionIds: string[]): Promise<{ all: string[]; selected: string[] }> {
  const sessions = await all<{ id: string; option_id: string | null }>(db, 'SELECT id, option_id FROM event_sessions WHERE event_id = ? AND deleted_at IS NULL', eventId);
  return { all: sessions.map((s) => s.id), selected: sessions.filter((s) => s.option_id && optionIds.includes(s.option_id)).map((s) => s.id) };
}

/** Apply an RSVP outcome to the event guest record and per-session statuses. */
export async function applyRsvp(db: D1Database, p: { eventId: string; eventGuestId: string; outcome: RsvpOutcome; submissionId: string | null; selectedSessionIds: string[]; allSessionIds: string[] }): Promise<void> {
  const status = p.outcome.status ?? 'accepted';
  const ts = nowIso();
  const stmts = [
    db.prepare(`UPDATE event_guests SET rsvp_status = ?, rsvp_at = ?, party_size = ?, adults = ?, children = ?, meal = COALESCE(?, meal), dietary = COALESCE(?, dietary),
      latest_submission_id = COALESCE(?, latest_submission_id), updated_at = ? WHERE id = ?`)
      .bind(status, ts, p.outcome.partySize, p.outcome.adults, p.outcome.children, p.outcome.meal ?? null, p.outcome.dietary || null, p.submissionId, ts, p.eventGuestId),
    db.prepare('UPDATE invitations SET responded_at = ?, updated_at = ? WHERE event_guest_id = ?').bind(ts, ts, p.eventGuestId),
  ];
  if (p.allSessionIds.length) {
    // When the form has an event_selection field, sessions not chosen are declined.
    const chosen = p.outcome.sessionOptionIds.length ? p.selectedSessionIds : status === 'declined' ? [] : p.allSessionIds;
    for (const sid of p.allSessionIds) {
      const s = status === 'declined' ? 'declined' : chosen.includes(sid) ? status : 'declined';
      stmts.push(db.prepare(`INSERT INTO event_guest_sessions (event_guest_id, session_id, rsvp_status) VALUES (?, ?, ?)
        ON CONFLICT(event_guest_id, session_id) DO UPDATE SET rsvp_status = excluded.rsvp_status`).bind(p.eventGuestId, sid, s));
    }
  }
  await db.batch(stmts);
}
