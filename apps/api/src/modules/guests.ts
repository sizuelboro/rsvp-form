import { Hono } from 'hono';
import { z } from 'zod';
import { EMAIL_RE } from '@rsvp/core';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { newId } from '../lib/crypto';
import { all, first, isUniqueViolation, likeEscape, nowIso, run } from '../lib/db';
import { ApiError, body, conflict, notFound, parseJson, query } from '../lib/http';
import { requireFeature, requireWithinLimit } from '../lib/entitlements';
import { audit } from '../lib/audit';
import { csvResponse, parseCsv, toCsv } from '../lib/csv';
import { ensureEventGuest, normalizeEmail, normalizePhone } from '../services/rsvp';

export const guests = new Hono<AppBindings>();

// Guest management is a plan feature; every route in this module is gated server-side.
guests.use('*', async (c, next) => {
  await requireFeature(c.env.DB, c.get('workspace').id, 'guestManagement');
  await next();
});

const guestInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(254).refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email').nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  groupId: z.string().max(40).nullable().optional(),
  householdId: z.string().max(40).nullable().optional(),
  dietary: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  attributes: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
});

async function assertRefs(db: D1Database, wid: string, groupId?: string | null, householdId?: string | null) {
  if (groupId && !(await first(db, 'SELECT 1 FROM guest_groups WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', groupId, wid))) throw notFound('Group');
  if (householdId && !(await first(db, 'SELECT 1 FROM households WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', householdId, wid))) throw notFound('Household');
}

const listQuery = z.object({
  search: z.string().max(100).optional(),
  groupId: z.string().max(40).optional(),
  householdId: z.string().max(40).optional(),
  eventId: z.string().max(40).optional(),
  sort: z.enum(['name', 'email', 'created_at', 'updated_at']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

guests.get('/', async (c) => {
  const q = query(c, listQuery);
  const wid = c.get('workspace').id;
  const where = ['g.workspace_id = ?', 'g.deleted_at IS NULL'];
  const params: unknown[] = [wid];
  if (q.search) { where.push("(g.name LIKE ? ESCAPE '\\' OR g.email LIKE ? ESCAPE '\\' OR g.phone LIKE ? ESCAPE '\\' OR g.notes LIKE ? ESCAPE '\\')"); const s = likeEscape(q.search); params.push(s, s, s, s); }
  if (q.groupId) { where.push('g.group_id = ?'); params.push(q.groupId); }
  if (q.householdId) { where.push('g.household_id = ?'); params.push(q.householdId); }
  if (q.eventId) { where.push('EXISTS (SELECT 1 FROM event_guests eg WHERE eg.guest_id = g.id AND eg.event_id = ?)'); params.push(q.eventId); }
  const sortCol = { name: 'g.name COLLATE NOCASE', email: 'g.email', created_at: 'g.created_at', updated_at: 'g.updated_at' }[q.sort];
  const total = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM guests g WHERE ${where.join(' AND ')}`, ...params);
  const items = await all<Record<string, unknown> & { attributes: string }>(c.env.DB, `SELECT g.id, g.name, g.email, g.phone, g.group_id, gg.name AS group_name, g.household_id, h.name AS household_name, g.dietary, g.notes, g.attributes, g.created_at, g.updated_at,
      (SELECT COUNT(*) FROM event_guests eg JOIN events e ON e.id = eg.event_id AND e.deleted_at IS NULL WHERE eg.guest_id = g.id) AS event_count
    FROM guests g LEFT JOIN guest_groups gg ON gg.id = g.group_id LEFT JOIN households h ON h.id = g.household_id
    WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${q.dir.toUpperCase()}, g.id LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return c.json({ items: items.map((g) => ({ ...g, attributes: parseJson(g.attributes, {}) })), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

guests.post('/', permission('content.write'), async (c) => {
  const input = await body(c, guestInput);
  const wid = c.get('workspace').id;
  await requireWithinLimit(c.env.DB, wid, 'guests');
  await assertRefs(c.env.DB, wid, input.groupId, input.householdId);
  const id = newId('gst');
  try {
    await run(c.env.DB, `INSERT INTO guests (id, workspace_id, name, email, email_normalized, phone, phone_normalized, group_id, household_id, dietary, notes, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, wid, input.name, input.email || null, normalizeEmail(input.email), input.phone || null, normalizePhone(input.phone), input.groupId ?? null, input.householdId ?? null, input.dietary ?? null, input.notes ?? null, JSON.stringify(input.attributes ?? {}));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A guest with this email already exists');
    throw e;
  }
  return c.json({ id }, 201);
});

guests.get('/:guestId', async (c) => {
  const wid = c.get('workspace').id;
  const g = await first<Record<string, unknown> & { attributes: string }>(c.env.DB, 'SELECT * FROM guests WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', c.req.param('guestId'), wid);
  if (!g) throw notFound('Guest');
  const eventsList = await all(c.env.DB, `SELECT e.id, e.name, e.starts_at, eg.id AS event_guest_id, eg.rsvp_status, eg.party_size, eg.meal, i.status AS invitation_status,
    (SELECT MIN(ci.created_at) FROM checkins ci WHERE ci.event_guest_id = eg.id AND ci.undone_at IS NULL) AS checked_in_at
    FROM event_guests eg JOIN events e ON e.id = eg.event_id LEFT JOIN invitations i ON i.event_guest_id = eg.id WHERE eg.guest_id = ? AND e.deleted_at IS NULL ORDER BY e.starts_at DESC`, g.id);
  const { email_normalized, phone_normalized, ...rest } = g;
  return c.json({ ...rest, attributes: parseJson(g.attributes, {}), events: eventsList });
});

guests.patch('/:guestId', permission('content.write'), async (c) => {
  const input = await body(c, guestInput.partial());
  const wid = c.get('workspace').id;
  await assertRefs(c.env.DB, wid, input.groupId, input.householdId);
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, v: unknown) => { sets.push(`${col} = ?`); params.push(v); };
  if (input.name !== undefined) add('name', input.name);
  if (input.email !== undefined) { add('email', input.email || null); add('email_normalized', normalizeEmail(input.email)); }
  if (input.phone !== undefined) { add('phone', input.phone || null); add('phone_normalized', normalizePhone(input.phone)); }
  if (input.groupId !== undefined) add('group_id', input.groupId);
  if (input.householdId !== undefined) add('household_id', input.householdId);
  if (input.dietary !== undefined) add('dietary', input.dietary);
  if (input.notes !== undefined) add('notes', input.notes);
  if (input.attributes !== undefined) add('attributes', JSON.stringify(input.attributes));
  if (!sets.length) return c.json({ ok: true });
  try {
    const res = await run(c.env.DB, `UPDATE guests SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`, ...params, nowIso(), c.req.param('guestId'), wid);
    if (!res.meta.changes) throw notFound('Guest');
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A guest with this email already exists');
    throw e;
  }
  return c.json({ ok: true });
});

guests.delete('/:guestId', permission('content.write'), async (c) => {
  const res = await run(c.env.DB, 'UPDATE guests SET deleted_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', nowIso(), c.req.param('guestId'), c.get('workspace').id);
  if (!res.meta.changes) throw notFound('Guest');
  return c.json({ ok: true });
});

/** Bulk actions over selected guests. */
guests.post('/bulk', permission('content.write'), async (c) => {
  const input = await body(c, z.object({
    guestIds: z.array(z.string().max(40)).min(1).max(2000),
    action: z.enum(['delete', 'set_group', 'set_household', 'add_to_event']),
    groupId: z.string().max(40).nullable().optional(),
    householdId: z.string().max(40).nullable().optional(),
    eventId: z.string().max(40).optional(),
  }));
  const wid = c.get('workspace').id;
  const db = c.env.DB;
  const ids = (await all<{ id: string }>(db, `SELECT id FROM guests WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (${input.guestIds.map(() => '?').join(',')})`, wid, ...input.guestIds)).map((r) => r.id);
  const ts = nowIso();
  if (input.action === 'delete') await db.batch(ids.map((id) => db.prepare('UPDATE guests SET deleted_at = ? WHERE id = ?').bind(ts, id)));
  if (input.action === 'set_group') { await assertRefs(db, wid, input.groupId); await db.batch(ids.map((id) => db.prepare('UPDATE guests SET group_id = ?, updated_at = ? WHERE id = ?').bind(input.groupId ?? null, ts, id))); }
  if (input.action === 'set_household') { await assertRefs(db, wid, null, input.householdId); await db.batch(ids.map((id) => db.prepare('UPDATE guests SET household_id = ?, updated_at = ? WHERE id = ?').bind(input.householdId ?? null, ts, id))); }
  if (input.action === 'add_to_event') {
    if (!input.eventId || !(await first(db, 'SELECT 1 FROM events WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', input.eventId, wid))) throw notFound('Event');
    for (const id of ids) await ensureEventGuest(db, wid, input.eventId, id);
  }
  await audit(c, `guests.bulk_${input.action}`, undefined, { count: ids.length });
  return c.json({ affected: ids.length });
});

// ─── CSV import / export ───

const HEADER_ALIASES: Record<string, string> = {
  name: 'name', 'full name': 'name', 'guest name': 'name', 'first name': 'first_name', 'last name': 'last_name',
  email: 'email', 'email address': 'email', 'e-mail': 'email', phone: 'phone', mobile: 'phone', 'phone number': 'phone',
  group: 'group', 'guest group': 'group', household: 'household', family: 'household', notes: 'notes', note: 'notes', dietary: 'dietary', 'dietary restrictions': 'dietary',
};

export interface ImportRow { name: string; email: string | null; phone: string | null; group: string | null; household: string | null; notes: string | null; dietary: string | null; attributes: Record<string, string> }

export function mapCsv(rows: string[][]): { rows: ImportRow[]; errors: { line: number; message: string }[]; columns: string[] } {
  const [header, ...data] = rows;
  if (!header) return { rows: [], errors: [{ line: 1, message: 'The file is empty' }], columns: [] };
  const cols = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? `attr:${h.trim().slice(0, 60)}`);
  const out: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  data.forEach((r, i) => {
    const rec: Record<string, string> = {};
    const attributes: Record<string, string> = {};
    cols.forEach((col, ci) => {
      const v = (r[ci] ?? '').trim();
      if (col.startsWith('attr:')) { if (v && col.length > 5) attributes[col.slice(5)] = v.slice(0, 500); } else rec[col] = v;
    });
    const name = (rec.name || [rec.first_name, rec.last_name].filter(Boolean).join(' ')).slice(0, 200);
    const line = i + 2;
    if (!name) { errors.push({ line, message: 'Missing name' }); return; }
    const email = rec.email || null;
    if (email && !EMAIL_RE.test(email)) { errors.push({ line, message: `Invalid email "${email}"` }); return; }
    out.push({ name, email, phone: rec.phone || null, group: rec.group || null, household: rec.household || null, notes: rec.notes || null, dietary: rec.dietary || null, attributes });
  });
  return { rows: out, errors, columns: header };
}

guests.post('/import', permission('content.write'), async (c) => {
  const input = await body(c, z.object({ csv: z.string().min(1).max(5_000_000), eventId: z.string().max(40).optional(), dryRun: z.boolean().default(false), updateExisting: z.boolean().default(true) }), 6_000_000);
  const wid = c.get('workspace').id;
  const db = c.env.DB;
  const parsed = mapCsv(parseCsv(input.csv));
  if (parsed.rows.length > 5000) throw new ApiError(413, 'too_many_rows', 'Import up to 5,000 guests at a time');
  if (input.eventId && !(await first(db, 'SELECT 1 FROM events WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', input.eventId, wid))) throw notFound('Event');

  // Classify rows: duplicates inside the file, existing guests (by email or name+phone), new guests.
  const seen = new Set<string>();
  const plan: { row: ImportRow; existingId: string | null; duplicateInFile: boolean }[] = [];
  for (const row of parsed.rows) {
    const key = normalizeEmail(row.email) ?? `${row.name.toLowerCase()}|${normalizePhone(row.phone) ?? ''}`;
    const dup = seen.has(key);
    seen.add(key);
    let existingId: string | null = null;
    const em = normalizeEmail(row.email);
    if (em) existingId = (await first<{ id: string }>(db, 'SELECT id FROM guests WHERE workspace_id = ? AND email_normalized = ? AND deleted_at IS NULL', wid, em))?.id ?? null;
    else if (normalizePhone(row.phone)) existingId = (await first<{ id: string }>(db, 'SELECT id FROM guests WHERE workspace_id = ? AND phone_normalized = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL', wid, normalizePhone(row.phone), row.name))?.id ?? null;
    else existingId = (await first<{ id: string }>(db, 'SELECT id FROM guests WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND email_normalized IS NULL AND deleted_at IS NULL', wid, row.name))?.id ?? null;
    plan.push({ row, existingId, duplicateInFile: dup });
  }
  const toCreate = plan.filter((p) => !p.existingId && !p.duplicateInFile).length;
  const summary = { total: parsed.rows.length, create: toCreate, update: plan.filter((p) => p.existingId && !p.duplicateInFile).length, duplicatesInFile: plan.filter((p) => p.duplicateInFile).length, errors: parsed.errors, columns: parsed.columns };
  if (input.dryRun) return c.json({ ...summary, preview: plan.slice(0, 20).map((p) => ({ ...p.row, status: p.duplicateInFile ? 'duplicate' : p.existingId ? 'update' : 'new' })) });

  await requireWithinLimit(db, wid, 'guests', toCreate);
  const groupCache = new Map<string, string>();
  const householdCache = new Map<string, string>();
  const resolveNamed = async (table: 'guest_groups' | 'households', name: string | null, cache: Map<string, string>) => {
    if (!name) return null;
    const k = name.toLowerCase();
    if (cache.has(k)) return cache.get(k)!;
    let row = await first<{ id: string }>(db, `SELECT id FROM ${table} WHERE workspace_id = ? AND name = ? AND deleted_at IS NULL`, wid, name);
    if (!row) {
      const id = newId(table === 'guest_groups' ? 'grp' : 'hh');
      await run(db, `INSERT INTO ${table} (id, workspace_id, name) VALUES (?, ?, ?)`, id, wid, name.slice(0, 120));
      row = { id };
    }
    cache.set(k, row.id);
    return row.id;
  };

  let created = 0, updated = 0;
  const ts = nowIso();
  for (const p of plan) {
    if (p.duplicateInFile) continue;
    const r = p.row;
    const groupId = await resolveNamed('guest_groups', r.group, groupCache);
    const householdId = await resolveNamed('households', r.household, householdCache);
    let guestId = p.existingId;
    if (guestId) {
      if (input.updateExisting) {
        const cur = await first<{ attributes: string }>(db, 'SELECT attributes FROM guests WHERE id = ?', guestId);
        await run(db, `UPDATE guests SET name = ?, phone = COALESCE(?, phone), phone_normalized = COALESCE(?, phone_normalized), group_id = COALESCE(?, group_id), household_id = COALESCE(?, household_id),
          notes = COALESCE(?, notes), dietary = COALESCE(?, dietary), attributes = ?, updated_at = ? WHERE id = ?`,
          r.name, r.phone, normalizePhone(r.phone), groupId, householdId, r.notes, r.dietary, JSON.stringify({ ...parseJson(cur?.attributes, {}), ...r.attributes }), ts, guestId);
        updated++;
      }
    } else {
      guestId = newId('gst');
      await run(db, `INSERT INTO guests (id, workspace_id, name, email, email_normalized, phone, phone_normalized, group_id, household_id, notes, dietary, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        guestId, wid, r.name, r.email, normalizeEmail(r.email), r.phone, normalizePhone(r.phone), groupId, householdId, r.notes, r.dietary, JSON.stringify(r.attributes));
      created++;
    }
    if (input.eventId) await ensureEventGuest(db, wid, input.eventId, guestId);
  }
  await audit(c, 'guests.imported', undefined, { created, updated, eventId: input.eventId ?? null });
  return c.json({ ...summary, created, updated });
});

guests.get('/export/csv', async (c) => {
  const wid = c.get('workspace').id;
  const rows = await all<Record<string, string | null>>(c.env.DB, `SELECT g.name, g.email, g.phone, gg.name AS group_name, h.name AS household_name, g.dietary, g.notes, g.attributes, g.created_at
    FROM guests g LEFT JOIN guest_groups gg ON gg.id = g.group_id LEFT JOIN households h ON h.id = g.household_id WHERE g.workspace_id = ? AND g.deleted_at IS NULL ORDER BY g.name COLLATE NOCASE`, wid);
  const attrKeys = [...new Set(rows.flatMap((r) => Object.keys(parseJson<Record<string, string>>(r.attributes, {}))))].sort();
  const csv = toCsv([
    ['Name', 'Email', 'Phone', 'Group', 'Household', 'Dietary', 'Notes', ...attrKeys, 'Created at'],
    ...rows.map((r) => { const a = parseJson<Record<string, string>>(r.attributes, {}); return [r.name, r.email, r.phone, r.group_name, r.household_name, r.dietary, r.notes, ...attrKeys.map((k) => a[k] ?? ''), r.created_at]; }),
  ]);
  return csvResponse('guests.csv', csv);
});

// ─── Groups & households ───
for (const [path, table, prefix] of [['groups', 'guest_groups', 'grp'], ['households', 'households', 'hh']] as const) {
  guests.get(`/meta/${path}`, async (c) => {
    const items = await all(c.env.DB, `SELECT t.id, t.name, ${table === 'guest_groups' ? 't.color,' : ''} (SELECT COUNT(*) FROM guests g WHERE g.${table === 'guest_groups' ? 'group_id' : 'household_id'} = t.id AND g.deleted_at IS NULL) AS guest_count
      FROM ${table} t WHERE t.workspace_id = ? AND t.deleted_at IS NULL ORDER BY t.name`, c.get('workspace').id);
    return c.json({ items });
  });
  guests.post(`/meta/${path}`, permission('content.write'), async (c) => {
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(120), color: z.string().max(20).optional() }));
    const id = newId(prefix);
    try {
      if (table === 'guest_groups') await run(c.env.DB, 'INSERT INTO guest_groups (id, workspace_id, name, color) VALUES (?, ?, ?, ?)', id, c.get('workspace').id, input.name, input.color ?? null);
      else await run(c.env.DB, 'INSERT INTO households (id, workspace_id, name) VALUES (?, ?, ?)', id, c.get('workspace').id, input.name);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A record with this name already exists');
      throw e;
    }
    return c.json({ id }, 201);
  });
  guests.delete(`/meta/${path}/:id`, permission('content.write'), async (c) => {
    const ts = nowIso();
    const col = table === 'guest_groups' ? 'group_id' : 'household_id';
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ? AND workspace_id = ?`).bind(ts, c.req.param('id'), c.get('workspace').id),
      c.env.DB.prepare(`UPDATE guests SET ${col} = NULL WHERE ${col} = ? AND workspace_id = ?`).bind(c.req.param('id'), c.get('workspace').id),
    ]);
    return c.json({ ok: true });
  });
}
