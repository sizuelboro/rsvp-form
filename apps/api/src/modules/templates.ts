import { Hono } from 'hono';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '@rsvp/core';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { all, nowIso, run } from '../lib/db';
import { notFound, parseJson } from '../lib/http';

/** System templates are code-defined (versioned with the schema); workspace templates live in D1. */
export const templates = new Hono<AppBindings>();

templates.get('/', async (c) => {
  const custom = await all<{ id: string; name: string; category: string; description: string; schema: string; created_at: string }>(
    c.env.DB, 'SELECT id, name, category, description, schema, created_at FROM templates WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', c.get('workspace').id);
  return c.json({
    categories: TEMPLATE_CATEGORIES,
    system: TEMPLATES,
    custom: custom.map((t) => ({ ...t, schema: parseJson(t.schema, null), isCustom: true })),
  });
});

templates.delete('/:templateId', permission('content.write'), async (c) => {
  const res = await run(c.env.DB, 'UPDATE templates SET deleted_at = ? WHERE id = ? AND workspace_id = ?', nowIso(), c.req.param('templateId'), c.get('workspace').id);
  if (!res.meta.changes) throw notFound('Template');
  return c.json({ ok: true });
});
