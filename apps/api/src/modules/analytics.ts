import { Hono } from 'hono';
import { z } from 'zod';
import { allElements, migrateSchema, type FormSchema } from '@rsvp/core';
import type { AppBindings } from '../env';
import { all, first } from '../lib/db';
import { notFound, parseJson, query } from '../lib/http';
import { getEntitlements } from '../lib/entitlements';
import { csvResponse, toCsv } from '../lib/csv';
import { loadForm } from './forms';
import { loadEvent } from './events';

export const analytics = new Hono<AppBindings>();

const range = z.object({ from: z.string().max(30).optional(), to: z.string().max(30).optional() });
const bounds = (q: z.infer<typeof range>) => ({
  from: q.from ?? '0000',
  to: q.to ? (q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to) : '9999',
});

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

analytics.get('/overview', async (c) => {
  const wid = c.get('workspace').id;
  const db = c.env.DB;
  const totals = await first<{ forms: number; active_forms: number; responses: number; events: number; responses_7d: number; upcoming_events: number }>(db, `SELECT
    (SELECT COUNT(*) FROM forms WHERE workspace_id = ?1 AND deleted_at IS NULL) AS forms,
    (SELECT COUNT(*) FROM forms WHERE workspace_id = ?1 AND deleted_at IS NULL AND status = 'published') AS active_forms,
    (SELECT COUNT(*) FROM submissions WHERE workspace_id = ?1 AND deleted_at IS NULL AND status != 'spam') AS responses,
    (SELECT COUNT(*) FROM submissions WHERE workspace_id = ?1 AND deleted_at IS NULL AND status != 'spam' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) AS responses_7d,
    (SELECT COUNT(*) FROM events WHERE workspace_id = ?1 AND deleted_at IS NULL) AS events,
    (SELECT COUNT(*) FROM events WHERE workspace_id = ?1 AND deleted_at IS NULL AND starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now') AND status != 'cancelled') AS upcoming_events`, wid);
  const timeline = await all<{ day: string; n: number }>(db, `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM submissions WHERE workspace_id = ? AND deleted_at IS NULL AND status != 'spam'
    AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') GROUP BY day ORDER BY day`, wid);
  return c.json({ totals, timeline });
});

/** Workspace-wide analytics across forms and events (Analytics page). */
analytics.get('/workspace', async (c) => {
  const q = query(c, range);
  const { from, to } = bounds(q);
  const wid = c.get('workspace').id;
  const db = c.env.DB;
  const funnel = await first<{ views: number; starts: number; completions: number }>(db, `SELECT COUNT(*) AS views, COUNT(started_at) AS starts, COUNT(completed_at) AS completions FROM form_visits WHERE workspace_id = ? AND created_at BETWEEN ? AND ?`, wid, from, to);
  const devices = await all<{ device: string; n: number }>(db, `SELECT COALESCE(json_extract(meta, '$.device'), 'desktop') AS device, COUNT(*) AS n FROM submissions WHERE workspace_id = ? AND deleted_at IS NULL AND status != 'spam' AND created_at BETWEEN ? AND ? GROUP BY device`, wid, from, to);
  const timeline = await all<{ day: string; n: number }>(db, `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM submissions WHERE workspace_id = ? AND deleted_at IS NULL AND status != 'spam' AND created_at BETWEEN ? AND ? GROUP BY day ORDER BY day`, wid, from, to);
  const topForms = await all(db, `SELECT f.id, f.name, COUNT(s.id) AS responses,
      (SELECT COUNT(*) FROM form_visits v WHERE v.form_id = f.id AND v.created_at BETWEEN ? AND ?) AS views
    FROM forms f LEFT JOIN submissions s ON s.form_id = f.id AND s.deleted_at IS NULL AND s.status != 'spam' AND s.created_at BETWEEN ? AND ?
    WHERE f.workspace_id = ? AND f.deleted_at IS NULL GROUP BY f.id ORDER BY responses DESC LIMIT 10`, from, to, from, to, wid);
  const rsvp = await first<{ invited: number; accepted: number; declined: number; pending: number; expected: number; checked_in: number }>(db, `SELECT
      COUNT(*) AS invited, SUM(eg.rsvp_status = 'accepted') AS accepted, SUM(eg.rsvp_status = 'declined') AS declined, SUM(eg.rsvp_status IN ('pending','maybe')) AS pending,
      COALESCE(SUM(CASE WHEN eg.rsvp_status = 'accepted' THEN eg.party_size END), 0) AS expected,
      (SELECT COUNT(DISTINCT ci.event_guest_id) FROM checkins ci JOIN events e ON e.id = ci.event_id WHERE ci.workspace_id = ? AND ci.undone_at IS NULL AND e.deleted_at IS NULL) AS checked_in
    FROM event_guests eg JOIN events e ON e.id = eg.event_id AND e.deleted_at IS NULL JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.workspace_id = ?`, wid, wid);
  const v = funnel ?? { views: 0, starts: 0, completions: 0 };
  return c.json({
    funnel: { ...v, abandonment: Math.max(0, v.starts - v.completions), completionRate: pct(v.completions, v.starts), conversionRate: pct(v.completions, v.views) },
    devices, timeline, topForms,
    rsvp: { ...rsvp, accepted: rsvp?.accepted ?? 0, declined: rsvp?.declined ?? 0, pending: rsvp?.pending ?? 0, responseRate: pct((rsvp?.accepted ?? 0) + (rsvp?.declined ?? 0), rsvp?.invited ?? 0) },
  });
});

async function choiceBreakdowns(db: D1Database, formId: string, schema: FormSchema, from: string, to: string) {
  const choiceEls = allElements(schema).filter((el) => ['single_choice', 'dropdown', 'yes_no', 'attendance', 'meal_preference', 'accommodation', 'transportation', 'rating'].includes(el.type));
  const out = [];
  for (const el of choiceEls.slice(0, 20)) {
    const rows = await all<{ value: string; n: number }>(db, `SELECT ${el.type === 'rating' ? 'CAST(a.value_number AS INTEGER)' : 'a.value_text'} AS value, COUNT(*) AS n FROM answers a JOIN submissions s ON s.id = a.submission_id
      WHERE a.form_id = ? AND a.field_id = ? AND s.deleted_at IS NULL AND s.status != 'spam' AND s.created_at BETWEEN ? AND ? GROUP BY value ORDER BY n DESC`, formId, el.id, from, to);
    const label = (v: string) => el.type === 'yes_no' ? (v === 'yes' ? 'Yes' : 'No')
      : el.type === 'attendance' ? (v === 'accept' ? el.config.acceptLabel ?? 'Accept' : v === 'decline' ? el.config.declineLabel ?? 'Decline' : el.config.maybeLabel ?? 'Maybe')
      : el.config.options?.find((o) => o.id === v)?.label ?? String(v);
    out.push({ fieldId: el.id, label: el.label || el.id, type: el.type, values: rows.map((r) => ({ value: r.value, label: label(String(r.value)), count: r.n })) });
  }
  return out;
}

analytics.get('/forms/:formId', async (c) => {
  const q = query(c, range);
  const { from, to } = bounds(q);
  const wid = c.get('workspace').id;
  const db = c.env.DB;
  const f = await loadForm(db, wid, c.req.param('formId'));
  const ent = await getEntitlements(db, wid);
  const funnel = await first<{ views: number; starts: number; completions: number }>(db, 'SELECT COUNT(*) AS views, COUNT(started_at) AS starts, COUNT(completed_at) AS completions FROM form_visits WHERE form_id = ? AND created_at BETWEEN ? AND ?', f.id, from, to);
  const submissionsCount = await first<{ n: number; spam: number }>(db, "SELECT SUM(status != 'spam') AS n, SUM(status = 'spam') AS spam FROM submissions WHERE form_id = ? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?", f.id, from, to);
  const timeline = await all(db, "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM submissions WHERE form_id = ? AND deleted_at IS NULL AND status != 'spam' AND created_at BETWEEN ? AND ? GROUP BY day ORDER BY day", f.id, from, to);
  const devices = await all(db, "SELECT device, COUNT(*) AS n FROM form_visits WHERE form_id = ? AND created_at BETWEEN ? AND ? GROUP BY device", f.id, from, to);
  const v = funnel ?? { views: 0, starts: 0, completions: 0 };
  let fields: Awaited<ReturnType<typeof choiceBreakdowns>> = [];
  if (ent.features.advancedAnalytics && f.published_version_id) {
    const ver = await first<{ schema: string }>(db, 'SELECT schema FROM form_versions WHERE id = ?', f.published_version_id);
    const m = migrateSchema(parseJson(ver?.schema, {}));
    if (m.ok) fields = await choiceBreakdowns(db, f.id, m.schema, from, to);
  }
  return c.json({
    form: { id: f.id, name: f.name },
    funnel: { ...v, abandonment: Math.max(0, v.starts - v.completions), completionRate: pct(v.completions, v.starts), conversionRate: pct(v.completions, v.views) },
    submissions: submissionsCount?.n ?? 0, spam: submissionsCount?.spam ?? 0,
    timeline, devices, fields, advanced: ent.features.advancedAnalytics,
  });
});

async function eventStats(db: D1Database, eventId: string, from: string, to: string) {
  const s = await first<Record<string, number>>(db, `SELECT COUNT(*) AS invited,
      COALESCE(SUM(eg.rsvp_status = 'accepted'), 0) AS accepted, COALESCE(SUM(eg.rsvp_status = 'declined'), 0) AS declined,
      COALESCE(SUM(eg.rsvp_status = 'maybe'), 0) AS maybe, COALESCE(SUM(eg.rsvp_status = 'pending'), 0) AS pending,
      COALESCE(SUM(CASE WHEN eg.rsvp_status = 'accepted' THEN eg.party_size END), 0) AS expected_attendees,
      COALESCE(SUM(CASE WHEN eg.rsvp_status = 'accepted' THEN eg.adults END), 0) AS adults,
      COALESCE(SUM(CASE WHEN eg.rsvp_status = 'accepted' THEN eg.children END), 0) AS children
    FROM event_guests eg JOIN guests g ON g.id = eg.guest_id AND g.deleted_at IS NULL WHERE eg.event_id = ?`, eventId);
  const att = await first<{ guests: number; attendees: number }>(db, `SELECT COUNT(DISTINCT event_guest_id) AS guests, COALESCE(SUM(attendee_count), 0) AS attendees FROM
    (SELECT event_guest_id, MAX(attendee_count) AS attendee_count FROM checkins WHERE event_id = ? AND undone_at IS NULL GROUP BY event_guest_id)`, eventId);
  const inv = await first<Record<string, number>>(db, `SELECT COALESCE(SUM(status IN ('sent','delivered')), 0) AS sent, COALESCE(SUM(status = 'delivered'), 0) AS delivered, COALESCE(SUM(status = 'failed'), 0) AS failed,
    COALESCE(SUM(status = 'queued'), 0) AS queued, COUNT(opened_at) AS opened, COUNT(responded_at) AS responded FROM invitations WHERE event_id = ?`, eventId);
  const timeline = await all(db, `SELECT substr(eg.rsvp_at, 1, 10) AS day, SUM(eg.rsvp_status = 'accepted') AS accepted, SUM(eg.rsvp_status = 'declined') AS declined, SUM(eg.rsvp_status = 'maybe') AS maybe
    FROM event_guests eg WHERE eg.event_id = ? AND eg.rsvp_at IS NOT NULL AND eg.rsvp_at BETWEEN ? AND ? GROUP BY day ORDER BY day`, eventId, from, to);
  const meals = await all<{ meal: string; guests: number; attendees: number }>(db, `SELECT meal, COUNT(*) AS guests, SUM(party_size) AS attendees FROM event_guests WHERE event_id = ? AND rsvp_status = 'accepted' AND meal IS NOT NULL GROUP BY meal ORDER BY attendees DESC`, eventId);
  const partySizes = await all(db, `SELECT party_size AS size, COUNT(*) AS n FROM event_guests WHERE event_id = ? AND rsvp_status = 'accepted' GROUP BY party_size ORDER BY party_size`, eventId);
  const sessions = await all<{ id: string; name: string; capacity: number | null; accepted: number; expected_attendees: number; checked_in: number }>(db, `SELECT s.id, s.name, s.capacity,
      (SELECT COUNT(*) FROM event_guest_sessions x WHERE x.session_id = s.id AND x.rsvp_status = 'accepted') AS accepted,
      (SELECT COALESCE(SUM(eg.party_size),0) FROM event_guest_sessions x JOIN event_guests eg ON eg.id = x.event_guest_id WHERE x.session_id = s.id AND x.rsvp_status = 'accepted') AS expected_attendees,
      (SELECT COUNT(*) FROM checkins ci WHERE ci.session_id = s.id AND ci.undone_at IS NULL) AS checked_in
    FROM event_sessions s WHERE s.event_id = ? AND s.deleted_at IS NULL ORDER BY s.sort_order`, eventId);
  const st = s ?? {};
  const invited = st.invited ?? 0;
  const responded = (st.accepted ?? 0) + (st.declined ?? 0) + (st.maybe ?? 0);
  return {
    rsvp: { invited, accepted: st.accepted ?? 0, declined: st.declined ?? 0, maybe: st.maybe ?? 0, pending: st.pending ?? 0, responseRate: pct(responded, invited) },
    expected: { attendees: st.expected_attendees ?? 0, adults: st.adults ?? 0, children: st.children ?? 0 },
    // Actual attendance comes only from check-ins, never from RSVPs.
    attendance: { checkedInGuests: att?.guests ?? 0, checkedInAttendees: att?.attendees ?? 0, checkInRate: pct(att?.guests ?? 0, st.accepted ?? 0) },
    invitations: inv, timeline, meals, partySizes, sessions,
  };
}

analytics.get('/events/:eventId', async (c) => {
  const q = query(c, range);
  const { from, to } = bounds(q);
  const wid = c.get('workspace').id;
  const e = await loadEvent(c.env.DB, wid, c.req.param('eventId'));
  const stats = await eventStats(c.env.DB, e.id, from, to);
  // Map meal option ids to labels using the primary form.
  const form = await first<{ published_version_id: string | null; draft_schema: string }>(c.env.DB, 'SELECT f.published_version_id, f.draft_schema FROM event_forms ef JOIN forms f ON f.id = ef.form_id WHERE ef.event_id = ? ORDER BY ef.is_primary DESC LIMIT 1', e.id);
  let labels: Record<string, string> = {};
  if (form) {
    const ver = form.published_version_id ? await first<{ schema: string }>(c.env.DB, 'SELECT schema FROM form_versions WHERE id = ?', form.published_version_id) : null;
    const m = migrateSchema(parseJson(ver?.schema ?? form.draft_schema, {}));
    if (m.ok) {
      const meal = allElements(m.schema).find((el) => el.type === 'meal_preference');
      labels = Object.fromEntries((meal?.config.options ?? []).map((o) => [o.id, o.label]));
    }
  }
  return c.json({ event: { id: e.id, name: e.name }, ...stats, meals: stats.meals.map((m) => ({ ...m, label: labels[m.meal] ?? m.meal })) });
});

analytics.get('/events/:eventId/export', async (c) => {
  const q = query(c, range);
  const { from, to } = bounds(q);
  const e = await loadEvent(c.env.DB, c.get('workspace').id, c.req.param('eventId'));
  const s = await eventStats(c.env.DB, e.id, from, to);
  const rows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Invited', s.rsvp.invited], ['Accepted', s.rsvp.accepted], ['Declined', s.rsvp.declined], ['Maybe', s.rsvp.maybe], ['Pending', s.rsvp.pending],
    ['Response rate (%)', s.rsvp.responseRate], ['Expected attendees', s.expected.attendees], ['Expected adults', s.expected.adults], ['Expected children', s.expected.children],
    ['Checked-in guests', s.attendance.checkedInGuests], ['Checked-in attendees', s.attendance.checkedInAttendees], ['Check-in rate (%)', s.attendance.checkInRate],
    [], ['Meal', 'Attendees'], ...s.meals.map((m) => [m.meal, m.attendees]),
    [], ['Session', 'Accepted', 'Expected attendees', 'Checked in'], ...s.sessions.map((x) => [String(x.name), Number(x.accepted), Number(x.expected_attendees), Number(x.checked_in)]),
  ];
  return csvResponse(`${e.slug}-report.csv`, toCsv(rows));
});

