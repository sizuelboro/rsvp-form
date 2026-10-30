import { Hono } from 'hono';
import { z } from 'zod';
import {
  blankRsvpSchema, blankSchema, checkIntegrity, formSchemaV1, getTemplate, migrateSchema, parseFormSchema, slugify,
  CURRENT_SCHEMA_VERSION, type FormSchema,
} from '@rsvp/core';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { hashPassword, newId } from '../lib/crypto';
import { all, first, likeEscape, nowIso, run } from '../lib/db';
import { ApiError, body, conflict, decodeCursor, notFound, page, parseJson, query } from '../lib/http';
import { requireFeature, requireWithinLimit } from '../lib/entitlements';
import { audit } from '../lib/audit';
import { purgePublicFormCache } from './public';

export const forms = new Hono<AppBindings>();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['api', 'admin', 'app', 'login', 'signup', 'new', 'edit', 'settings', 'static', 'assets']);

export async function uniqueSlug(db: D1Database, table: 'forms' | 'events', base: string): Promise<string> {
  let slug = slugify(base, 50);
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-form`;
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? slug : `${slug}-${newId('x', 4).slice(2)}`;
    const exists = await first(db, `SELECT 1 FROM ${table} WHERE slug = ?`, candidate);
    if (!exists) return candidate;
  }
  return `${slug}-${newId('x', 8).slice(2)}`;
}

export interface FormRow {
  id: string; workspace_id: string; name: string; slug: string; kind: string; status: string;
  draft_schema: string; draft_revision: number; published_version_id: string | null; access: string;
  password_hash: string | null; closes_at: string | null; late_policy: string; closed_message: string | null;
  template_id: string | null; created_at: string; updated_at: string;
}

export async function loadForm(db: D1Database, workspaceId: string, formId: string): Promise<FormRow> {
  const f = await first<FormRow>(db, 'SELECT * FROM forms WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', formId, workspaceId);
  if (!f) throw notFound('Form');
  return f;
}

function serialize(f: FormRow, extra: Record<string, unknown> = {}) {
  const { password_hash, draft_schema, ...rest } = f;
  return { ...rest, hasPassword: Boolean(password_hash), schema: parseJson<FormSchema | null>(draft_schema, null), ...extra };
}

forms.get('/', async (c) => {
  const q = query(c, z.object({ search: z.string().max(100).optional(), status: z.enum(['draft', 'published', 'closed']).optional(), kind: z.enum(['form', 'rsvp']).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }));
  const { id } = c.get('workspace');
  const where = ['f.workspace_id = ?', 'f.deleted_at IS NULL'];
  const params: unknown[] = [id];
  if (q.search) { where.push("f.name LIKE ? ESCAPE '\\'"); params.push(likeEscape(q.search)); }
  if (q.status) { where.push('f.status = ?'); params.push(q.status); }
  if (q.kind) { where.push('f.kind = ?'); params.push(q.kind); }
  const cur = decodeCursor(q.cursor);
  if (cur) { where.push('(f.updated_at < ? OR (f.updated_at = ? AND f.id < ?))'); params.push(cur.createdAt, cur.createdAt, cur.id); }
  const rows = await all<FormRow & { responses: number; last_response_at: string | null }>(c.env.DB, `
    SELECT f.id, f.workspace_id, f.name, f.slug, f.kind, f.status, f.draft_revision, f.published_version_id, f.access, f.closes_at, f.created_at, f.updated_at,
      (SELECT COUNT(*) FROM submissions s WHERE s.form_id = f.id AND s.deleted_at IS NULL AND s.status != 'spam') AS responses,
      (SELECT MAX(created_at) FROM submissions s WHERE s.form_id = f.id AND s.deleted_at IS NULL) AS last_response_at,
      (SELECT e.name FROM event_forms ef JOIN events e ON e.id = ef.event_id WHERE ef.form_id = f.id AND e.deleted_at IS NULL LIMIT 1) AS event_name
    FROM forms f WHERE ${where.join(' AND ')} ORDER BY f.updated_at DESC, f.id DESC LIMIT ?`, ...params, q.limit + 1);
  const p = page(rows.map((r) => ({ ...r, created_at: r.updated_at, real_created_at: r.created_at })), q.limit);
  return c.json({ items: p.items.map(({ real_created_at, ...r }) => ({ ...r, created_at: real_created_at })), nextCursor: p.nextCursor });
});

forms.post('/', permission('content.write'), async (c) => {
  const input = await body(c, z.object({
    name: z.string().trim().min(1).max(200).optional(),
    templateId: z.string().max(80).optional(),
    kind: z.enum(['form', 'rsvp']).optional(),
    schema: z.unknown().optional(),
    eventId: z.string().max(40).optional(),
  }));
  const { id: wid } = c.get('workspace');
  await requireWithinLimit(c.env.DB, wid, 'forms');

  let schema: FormSchema;
  let kind = input.kind ?? 'form';
  let templateId: string | null = null;
  if (input.templateId?.startsWith('tpl_')) {
    const tpl = await first<{ schema: string }>(c.env.DB, 'SELECT schema FROM templates WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', input.templateId, wid);
    if (!tpl) throw notFound('Template');
    const res = migrateSchema(parseJson(tpl.schema, {}));
    if (!res.ok) throw new ApiError(422, 'invalid_template', 'Template schema is invalid', res.issues);
    schema = res.schema;
    templateId = input.templateId;
  } else if (input.templateId) {
    const tpl = getTemplate(input.templateId);
    if (!tpl) throw notFound('Template');
    schema = structuredClone(tpl.schema);
    kind = input.kind ?? (tpl.isRsvp ? 'rsvp' : 'form');
    templateId = tpl.id;
  } else if (input.schema) {
    const res = parseFormSchema(input.schema);
    if (!res.ok) throw new ApiError(422, 'invalid_schema', 'Form schema is invalid', res.issues);
    schema = res.schema;
  } else {
    schema = kind === 'rsvp' ? blankRsvpSchema(input.name ?? 'RSVP') : blankSchema(input.name ?? 'Untitled form');
  }
  if (input.name) schema.form.title = input.name;
  const name = input.name ?? schema.form.title;
  const formId = newId('frm');
  const slug = await uniqueSlug(c.env.DB, 'forms', name);
  const stmts = [c.env.DB.prepare('INSERT INTO forms (id, workspace_id, name, slug, kind, draft_schema, template_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(formId, wid, name, slug, kind, JSON.stringify(schema), templateId, c.get('user')!.id)];
  if (input.eventId) {
    const ev = await first(c.env.DB, 'SELECT 1 FROM events WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', input.eventId, wid);
    if (!ev) throw notFound('Event');
    const hasPrimary = await first(c.env.DB, 'SELECT 1 FROM event_forms WHERE event_id = ? AND is_primary = 1', input.eventId);
    stmts.push(c.env.DB.prepare('INSERT INTO event_forms (event_id, form_id, is_primary) VALUES (?, ?, ?)').bind(input.eventId, formId, hasPrimary ? 0 : 1));
  }
  await c.env.DB.batch(stmts);
  await audit(c, 'form.created', { type: 'form', id: formId }, { name, templateId });
  return c.json({ id: formId, slug }, 201);
});

forms.get('/:formId', async (c) => {
  const f = await loadForm(c.env.DB, c.get('workspace').id, c.req.param('formId'));
  const published = f.published_version_id
    ? await first<{ id: string; version: number; published_at: string }>(c.env.DB, 'SELECT id, version, published_at FROM form_versions WHERE id = ?', f.published_version_id)
    : null;
  const events = await all(c.env.DB, 'SELECT e.id, e.name, e.slug, ef.is_primary FROM event_forms ef JOIN events e ON e.id = ef.event_id WHERE ef.form_id = ? AND e.deleted_at IS NULL', f.id);
  const hasUnpublishedChanges = published ? await first<{ same: number }>(c.env.DB, 'SELECT (schema = ?) AS same FROM form_versions WHERE id = ?', f.draft_schema, f.published_version_id).then((r) => !r?.same) : true;
  return c.json(serialize(f, { published, events, hasUnpublishedChanges }));
});

const patchSchema = z.object({
  baseRevision: z.number().int().optional(),
  schema: z.unknown().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'Use lowercase letters, numbers and dashes').optional(),
  access: z.enum(['public', 'password', 'invite_only']).optional(),
  password: z.string().min(4).max(200).optional(),
  closesAt: z.string().datetime().nullable().optional(),
  latePolicy: z.enum(['block', 'allow', 'flag']).optional(),
  closedMessage: z.string().max(1000).nullable().optional(),
  status: z.enum(['published', 'closed']).optional(),
  force: z.boolean().optional(),
});

/**
 * Autosave endpoint. Uses optimistic concurrency: the client sends the revision it based its
 * edits on; if another tab/user saved in between, we return 409 with the latest draft
 * instead of silently overwriting it.
 */
forms.patch('/:formId', permission('content.write'), async (c) => {
  const input = await body(c, patchSchema, 2_000_000);
  const wid = c.get('workspace').id;
  const f = await loadForm(c.env.DB, wid, c.req.param('formId'));
  const ts = nowIso();
  let revision = f.draft_revision;
  let warnings: { path: string; message: string }[] = [];

  if (input.schema !== undefined) {
    const parsed = formSchemaV1.safeParse(input.schema);
    if (!parsed.success) throw new ApiError(422, 'invalid_schema', 'Form schema is invalid', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    warnings = checkIntegrity(parsed.data);
    const json = JSON.stringify(parsed.data);
    if (input.baseRevision === undefined && !input.force) throw new ApiError(422, 'validation_failed', 'baseRevision is required when saving the schema');
    const res = input.force
      ? await run(c.env.DB, 'UPDATE forms SET draft_schema = ?, draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?', json, ts, f.id)
      : await run(c.env.DB, 'UPDATE forms SET draft_schema = ?, draft_revision = draft_revision + 1, updated_at = ? WHERE id = ? AND draft_revision = ?', json, ts, f.id, input.baseRevision);
    if (!res.meta.changes) {
      const latest = await loadForm(c.env.DB, wid, f.id);
      throw conflict('This form was changed in another session', { revision: latest.draft_revision, schema: parseJson(latest.draft_schema, null), updatedAt: latest.updated_at });
    }
    revision = (await first<{ r: number }>(c.env.DB, 'SELECT draft_revision AS r FROM forms WHERE id = ?', f.id))?.r ?? revision;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name) { sets.push('name = ?'); params.push(input.name); }
  if (input.slug && input.slug !== f.slug) {
    if (RESERVED_SLUGS.has(input.slug)) throw conflict('This URL is reserved');
    const exists = await first(c.env.DB, 'SELECT 1 FROM forms WHERE slug = ? AND id != ?', input.slug, f.id);
    if (exists) throw conflict('This URL is already taken');
    sets.push('slug = ?'); params.push(input.slug);
  }
  if (input.access) {
    if (input.access === 'password' && !input.password && !f.password_hash) throw new ApiError(422, 'validation_failed', 'Set a password for password-protected forms');
    sets.push('access = ?'); params.push(input.access);
  }
  if (input.password) { sets.push('password_hash = ?'); params.push(await hashPassword(input.password)); }
  if (input.closesAt !== undefined) { sets.push('closes_at = ?'); params.push(input.closesAt); }
  if (input.latePolicy) { sets.push('late_policy = ?'); params.push(input.latePolicy); }
  if (input.closedMessage !== undefined) { sets.push('closed_message = ?'); params.push(input.closedMessage); }
  if (input.status) {
    if (input.status === 'published' && !f.published_version_id) throw new ApiError(422, 'validation_failed', 'Publish the form first');
    sets.push('status = ?'); params.push(input.status);
  }
  if (sets.length) {
    sets.push('updated_at = ?'); params.push(ts);
    await run(c.env.DB, `UPDATE forms SET ${sets.join(', ')} WHERE id = ?`, ...params, f.id);
    await audit(c, 'form.settings_updated', { type: 'form', id: f.id }, { ...input, schema: undefined, password: input.password ? '***' : undefined });
    await purgePublicFormCache(c, f.slug);
    if (input.slug) await purgePublicFormCache(c, input.slug);
  }
  return c.json({ revision, updatedAt: ts, warnings });
});

/** Publishing snapshots the draft into an immutable form_version. */
forms.post('/:formId/publish', permission('content.write'), async (c) => {
  const wid = c.get('workspace').id;
  const f = await loadForm(c.env.DB, wid, c.req.param('formId'));
  const res = parseFormSchema(parseJson(f.draft_schema, {}));
  if (!res.ok) throw new ApiError(422, 'invalid_schema', 'Fix these issues before publishing', res.issues);
  if (res.schema.logic.length) await requireFeature(c.env.DB, wid, 'conditionalLogic');
  const json = JSON.stringify(res.schema);
  if (f.published_version_id) {
    const same = await first<{ same: number }>(c.env.DB, 'SELECT (schema = ?) AS same FROM form_versions WHERE id = ?', json, f.published_version_id);
    if (same?.same) {
      if (f.status !== 'published') await run(c.env.DB, "UPDATE forms SET status = 'published', updated_at = ? WHERE id = ?", nowIso(), f.id);
      await purgePublicFormCache(c, f.slug);
      return c.json({ versionId: f.published_version_id, unchanged: true });
    }
  }
  const latest = await first<{ v: number | null }>(c.env.DB, 'SELECT MAX(version) AS v FROM form_versions WHERE form_id = ?', f.id);
  const version = (latest?.v ?? 0) + 1;
  const versionId = newId('fv');
  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO form_versions (id, form_id, workspace_id, version, schema_version, schema, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(versionId, f.id, wid, version, CURRENT_SCHEMA_VERSION, json, c.get('user')!.id, ts),
    c.env.DB.prepare("UPDATE forms SET published_version_id = ?, status = 'published', updated_at = ? WHERE id = ?").bind(versionId, ts, f.id),
  ]);
  await purgePublicFormCache(c, f.slug);
  await audit(c, 'form.published', { type: 'form', id: f.id }, { version });
  return c.json({ versionId, version, publishedAt: ts, url: `${c.env.APP_URL}/f/${f.slug}` });
});

forms.get('/:formId/versions', async (c) => {
  const f = await loadForm(c.env.DB, c.get('workspace').id, c.req.param('formId'));
  const items = await all(c.env.DB, `SELECT v.id, v.version, v.published_at, u.name AS published_by_name,
    (SELECT COUNT(*) FROM submissions s WHERE s.form_version_id = v.id AND s.deleted_at IS NULL) AS responses
    FROM form_versions v LEFT JOIN users u ON u.id = v.published_by WHERE v.form_id = ? ORDER BY v.version DESC`, f.id);
  return c.json({ items });
});

forms.get('/:formId/versions/:versionId', async (c) => {
  const f = await loadForm(c.env.DB, c.get('workspace').id, c.req.param('formId'));
  const v = await first<{ id: string; version: number; schema: string; published_at: string }>(c.env.DB, 'SELECT id, version, schema, published_at FROM form_versions WHERE id = ? AND form_id = ?', c.req.param('versionId'), f.id);
  if (!v) throw notFound('Version');
  const res = migrateSchema(parseJson(v.schema, {}));
  return c.json({ ...v, schema: res.ok ? res.schema : parseJson(v.schema, {}) });
});

/** Restore copies an old version into the draft; history is never rewritten. */
forms.post('/:formId/versions/:versionId/restore', permission('content.write'), async (c) => {
  const f = await loadForm(c.env.DB, c.get('workspace').id, c.req.param('formId'));
  const v = await first<{ schema: string; version: number }>(c.env.DB, 'SELECT schema, version FROM form_versions WHERE id = ? AND form_id = ?', c.req.param('versionId'), f.id);
  if (!v) throw notFound('Version');
  await run(c.env.DB, 'UPDATE forms SET draft_schema = ?, draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?', v.schema, nowIso(), f.id);
  await audit(c, 'form.version_restored', { type: 'form', id: f.id }, { version: v.version });
  return c.json({ ok: true });
});

forms.post('/:formId/duplicate', permission('content.write'), async (c) => {
  const wid = c.get('workspace').id;
  await requireWithinLimit(c.env.DB, wid, 'forms');
  const f = await loadForm(c.env.DB, wid, c.req.param('formId'));
  const id = newId('frm');
  const name = `${f.name} (copy)`;
  const slug = await uniqueSlug(c.env.DB, 'forms', name);
  await run(c.env.DB, 'INSERT INTO forms (id, workspace_id, name, slug, kind, draft_schema, template_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, wid, name, slug, f.kind, f.draft_schema, f.template_id, c.get('user')!.id);
  await audit(c, 'form.duplicated', { type: 'form', id }, { from: f.id });
  return c.json({ id, slug }, 201);
});

forms.delete('/:formId', permission('content.write'), async (c) => {
  const f = await loadForm(c.env.DB, c.get('workspace').id, c.req.param('formId'));
  // Free the slug for reuse while keeping the row for historical submissions.
  await run(c.env.DB, "UPDATE forms SET deleted_at = ?, status = 'closed', slug = slug || '--deleted-' || substr(id, 5) WHERE id = ?", nowIso(), f.id);
  await purgePublicFormCache(c, f.slug);
  await audit(c, 'form.deleted', { type: 'form', id: f.id }, { name: f.name });
  return c.json({ ok: true });
});

forms.post('/:formId/save-as-template', permission('content.write'), async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(120), category: z.string().max(40).default('custom'), description: z.string().max(500).default('') }));
  const wid = c.get('workspace').id;
  const f = await loadForm(c.env.DB, wid, c.req.param('formId'));
  const id = newId('tpl');
  await run(c.env.DB, 'INSERT INTO templates (id, workspace_id, name, category, description, schema, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', id, wid, input.name, input.category, input.description, f.draft_schema, c.get('user')!.id);
  return c.json({ id }, 201);
});
