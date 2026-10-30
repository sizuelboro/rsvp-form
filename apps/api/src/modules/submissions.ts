import { Hono } from 'hono';
import { z } from 'zod';
import { allElements, answerIndexText, formatAnswer, migrateSchema, validateAnswers, FIELD_DEFINITIONS, type FormSchema } from '@rsvp/core';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { newId } from '../lib/crypto';
import { all, first, likeEscape, nowIso, run } from '../lib/db';
import { ApiError, body, notFound, parseJson, query } from '../lib/http';
import { audit } from '../lib/audit';
import { csvResponse, toCsv } from '../lib/csv';
import { loadForm } from './forms';

export const submissions = new Hono<AppBindings>();

const listQuery = z.object({
  formId: z.string().max(40).optional(),
  eventId: z.string().max(40).optional(),
  status: z.enum(['complete', 'spam', 'reviewed', 'archived', 'all']).default('all'),
  rsvp: z.enum(['accepted', 'declined', 'maybe']).optional(),
  search: z.string().max(100).optional(),
  from: z.string().max(30).optional(),
  to: z.string().max(30).optional(),
  duplicates: z.enum(['only', 'exclude']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

function buildWhere(wid: string, q: z.infer<typeof listQuery>) {
  const where = ['s.workspace_id = ?', 's.deleted_at IS NULL'];
  const params: unknown[] = [wid];
  if (q.formId) { where.push('s.form_id = ?'); params.push(q.formId); }
  if (q.eventId) { where.push('s.event_id = ?'); params.push(q.eventId); }
  if (q.status === 'all') where.push("s.status != 'spam'");
  else { where.push('s.status = ?'); params.push(q.status); }
  if (q.rsvp) { where.push('s.rsvp_status = ?'); params.push(q.rsvp); }
  if (q.search) { where.push("(s.respondent_name LIKE ? ESCAPE '\\' OR s.respondent_email LIKE ? ESCAPE '\\' OR s.data LIKE ? ESCAPE '\\')"); const s = likeEscape(q.search); params.push(s, s, s); }
  if (q.from) { where.push('s.created_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('s.created_at <= ?'); params.push(q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to); }
  if (q.duplicates === 'only') where.push('s.duplicate_of IS NOT NULL');
  if (q.duplicates === 'exclude') where.push('s.duplicate_of IS NULL');
  return { where: where.join(' AND '), params };
}

submissions.get('/', async (c) => {
  const q = query(c, listQuery);
  const { where, params } = buildWhere(c.get('workspace').id, q);
  const total = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM submissions s WHERE ${where}`, ...params);
  const items = await all(c.env.DB, `SELECT s.id, s.form_id, f.name AS form_name, s.event_id, e.name AS event_name, s.status, s.respondent_name, s.respondent_email, s.rsvp_status, s.party_size,
      s.is_late, s.duplicate_of, s.spam_score, s.created_at, s.updated_at, v.version, json_extract(s.meta, '$.device') AS device
    FROM submissions s JOIN forms f ON f.id = s.form_id JOIN form_versions v ON v.id = s.form_version_id LEFT JOIN events e ON e.id = s.event_id
    WHERE ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return c.json({ items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
});

async function loadSubmission(db: D1Database, wid: string, id: string) {
  const s = await first<{ id: string; form_id: string; form_version_id: string; data: string; meta: string; status: string; event_id: string | null; [k: string]: unknown }>(
    db, 'SELECT * FROM submissions WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', id, wid);
  if (!s) throw notFound('Response');
  return s;
}

/** Responses are always rendered against the exact form version they were submitted to. */
submissions.get('/:submissionId', async (c) => {
  const wid = c.get('workspace').id;
  const s = await loadSubmission(c.env.DB, wid, c.req.param('submissionId'));
  const v = await first<{ schema: string; version: number }>(c.env.DB, 'SELECT schema, version FROM form_versions WHERE id = ?', s.form_version_id);
  const migrated = migrateSchema(parseJson(v?.schema, {}));
  const schema = migrated.ok ? migrated.schema : null;
  const data = parseJson<Record<string, unknown>>(s.data, {});
  const form = await first<{ name: string; slug: string }>(c.env.DB, 'SELECT name, slug FROM forms WHERE id = ?', s.form_id);
  const history = await all(c.env.DB, 'SELECT se.id, se.type, se.data, se.created_at, u.name AS actor_name FROM submission_events se LEFT JOIN users u ON u.id = se.actor_user_id WHERE se.submission_id = ? ORDER BY se.created_at', s.id);
  const answers = schema ? allElements(schema).filter((el) => FIELD_DEFINITIONS[el.type].isInput).map((el) => ({ fieldId: el.id, type: el.type, label: el.label || el.id, value: data[el.id] ?? null, display: formatAnswer(el, data[el.id]) })) : [];
  const { ip_hash, idempotency_key, dedupe_key, ...rest } = s;
  return c.json({ ...rest, data, meta: parseJson(s.meta, {}), form, version: v?.version, schema, answers, history });
});

/** Organizer edits are validated against the submission's own version, and recorded in history. */
submissions.patch('/:submissionId', permission('content.write'), async (c) => {
  const input = await body(c, z.object({ status: z.enum(['complete', 'spam', 'reviewed', 'archived']).optional(), answers: z.record(z.unknown()).optional() }));
  const wid = c.get('workspace').id;
  const s = await loadSubmission(c.env.DB, wid, c.req.param('submissionId'));
  const ts = nowIso();
  if (input.answers) {
    const v = await first<{ schema: string }>(c.env.DB, 'SELECT schema FROM form_versions WHERE id = ?', s.form_version_id);
    const migrated = migrateSchema(parseJson(v?.schema, {}));
    if (!migrated.ok) throw new ApiError(500, 'schema_error', 'Form version is unreadable');
    const schema: FormSchema = migrated.schema;
    const merged = { ...parseJson<Record<string, unknown>>(s.data, {}), ...input.answers };
    const result = validateAnswers(schema, merged);
    if (!result.ok) throw new ApiError(422, 'validation_failed', 'Please fix the highlighted fields', { fields: result.errors });
    const before = parseJson<Record<string, unknown>>(s.data, {});
    const changed = Object.keys({ ...before, ...result.cleaned }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(result.cleaned[k]));
    const els = allElements(schema);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE submissions SET data = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(result.cleaned), ts, s.id),
      c.env.DB.prepare('DELETE FROM answers WHERE submission_id = ?').bind(s.id),
      ...els.filter((el) => FIELD_DEFINITIONS[el.type].isInput && result.cleaned[el.id] !== undefined).map((el) =>
        c.env.DB.prepare('INSERT INTO answers (submission_id, form_id, field_id, field_type, value_text, value_number, value_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(s.id, s.form_id, el.id, el.type, answerIndexText(el, result.cleaned[el.id]), typeof result.cleaned[el.id] === 'number' ? result.cleaned[el.id] : el.type === 'guest_count' ? ((result.cleaned[el.id] as { adults: number; children: number }).adults + (result.cleaned[el.id] as { adults: number; children: number }).children) : null, el.type === 'signature' ? null : JSON.stringify(result.cleaned[el.id]))),
      c.env.DB.prepare("INSERT INTO submission_events (id, submission_id, type, actor_user_id, data) VALUES (?, ?, 'edited_by_organizer', ?, ?)").bind(newId('sev'), s.id, c.get('user')!.id, JSON.stringify({ changed })),
    ]);
  }
  if (input.status && input.status !== s.status) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?').bind(input.status, ts, s.id),
      c.env.DB.prepare("INSERT INTO submission_events (id, submission_id, type, actor_user_id, data) VALUES (?, ?, 'status_changed', ?, ?)").bind(newId('sev'), s.id, c.get('user')!.id, JSON.stringify({ from: s.status, to: input.status })),
    ]);
  }
  return c.json({ ok: true });
});

submissions.delete('/:submissionId', permission('responses.delete'), async (c) => {
  const s = await loadSubmission(c.env.DB, c.get('workspace').id, c.req.param('submissionId'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE submissions SET deleted_at = ? WHERE id = ?').bind(nowIso(), s.id),
    c.env.DB.prepare("UPDATE event_guests SET latest_submission_id = NULL WHERE latest_submission_id = ?").bind(s.id),
    c.env.DB.prepare("INSERT INTO submission_events (id, submission_id, type, actor_user_id) VALUES (?, ?, 'deleted', ?)").bind(newId('sev'), s.id, c.get('user')!.id),
  ]);
  await audit(c, 'submission.deleted', { type: 'submission', id: s.id });
  return c.json({ ok: true });
});

submissions.post('/bulk', permission('responses.delete'), async (c) => {
  const input = await body(c, z.object({ ids: z.array(z.string().max(40)).min(1).max(1000), action: z.enum(['delete', 'spam', 'reviewed', 'archived', 'complete']) }));
  const wid = c.get('workspace').id;
  const ts = nowIso();
  const stmts = input.ids.map((id) => input.action === 'delete'
    ? c.env.DB.prepare('UPDATE submissions SET deleted_at = ? WHERE id = ? AND workspace_id = ?').bind(ts, id, wid)
    : c.env.DB.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').bind(input.action, ts, id, wid));
  const res = await c.env.DB.batch(stmts);
  return c.json({ affected: res.reduce((n, r) => n + (r.meta.changes ?? 0), 0) });
});

/** Signed, short-lived download of an uploaded file attached to a response. */
submissions.get('/:submissionId/files', async (c) => {
  const s = await loadSubmission(c.env.DB, c.get('workspace').id, c.req.param('submissionId'));
  const key = c.req.query('key') ?? '';
  const up = await first<{ name: string; content_type: string }>(c.env.DB, 'SELECT name, content_type FROM uploads WHERE key = ? AND submission_id = ?', key, s.id);
  if (!up) throw notFound('File');
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) throw notFound('File');
  return new Response(obj.body, { headers: { 'content-type': up.content_type, 'content-disposition': `attachment; filename="${up.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
});

/** CSV export of a form's responses. Columns follow the current draft plus any fields from older versions. */
submissions.get('/export/csv', async (c) => {
  const q = query(c, listQuery.extend({ formId: z.string().max(40) }));
  const wid = c.get('workspace').id;
  const f = await loadForm(c.env.DB, wid, q.formId);
  const { where, params } = buildWhere(wid, q);
  const rows = await all<{ id: string; data: string; created_at: string; status: string; form_version_id: string; respondent_name: string | null; respondent_email: string | null; rsvp_status: string | null; is_late: number; duplicate_of: string | null }>(
    c.env.DB, `SELECT s.id, s.data, s.created_at, s.status, s.form_version_id, s.respondent_name, s.respondent_email, s.rsvp_status, s.is_late, s.duplicate_of FROM submissions s WHERE ${where} ORDER BY s.created_at`, ...params);
  const versions = await all<{ id: string; schema: string }>(c.env.DB, 'SELECT id, schema FROM form_versions WHERE form_id = ? ORDER BY version DESC', f.id);
  const columns = new Map<string, { label: string; el: ReturnType<typeof allElements>[number] }>();
  const schemas = new Map<string, FormSchema>();
  for (const v of versions) {
    const m = migrateSchema(parseJson(v.schema, {}));
    if (!m.ok) continue;
    schemas.set(v.id, m.schema);
    for (const el of allElements(m.schema)) if (FIELD_DEFINITIONS[el.type].isInput && !columns.has(el.id)) columns.set(el.id, { label: el.label || el.id, el });
  }
  const cols = [...columns.entries()];
  const csv = toCsv([
    ['Response ID', 'Submitted at (UTC)', 'Status', 'RSVP', 'Late', 'Duplicate of', ...cols.map(([, v]) => v.label)],
    ...rows.map((r) => {
      const data = parseJson<Record<string, unknown>>(r.data, {});
      const schema = schemas.get(r.form_version_id);
      return [r.id, r.created_at, r.status, r.rsvp_status ?? '', r.is_late ? 'yes' : '', r.duplicate_of ?? '',
        ...cols.map(([id, v]) => formatAnswer(schema ? allElements(schema).find((e) => e.id === id) ?? v.el : v.el, data[id]))];
    }),
  ]);
  await audit(c, 'submissions.exported', { type: 'form', id: f.id }, { count: rows.length });
  return csvResponse(`${f.slug}-responses.csv`, csv);
});
