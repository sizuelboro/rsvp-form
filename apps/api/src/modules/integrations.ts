import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { permission } from '../lib/auth';
import { newId, randomToken } from '../lib/crypto';
import { all, first, nowIso, run } from '../lib/db';
import { body, notFound, parseJson } from '../lib/http';
import { requireFeature } from '../lib/entitlements';
import { audit } from '../lib/audit';
import { enqueueWebhooks } from './notifications';

export const integrations = new Hono<AppBindings>();

const WEBHOOK_EVENTS = ['submission.created', 'submission.updated', 'webhook.test'] as const;

integrations.get('/', async (c) => {
  const items = await all<{ id: string; type: string; name: string; config: string; enabled: number; created_at: string }>(c.env.DB, 'SELECT id, type, name, config, enabled, created_at FROM integrations WHERE workspace_id = ? ORDER BY created_at', c.get('workspace').id);
  const deliveries = await all(c.env.DB, "SELECT recipient AS integration_id, status, last_error, created_at, type FROM notification_jobs WHERE workspace_id = ? AND channel = 'webhook' ORDER BY created_at DESC LIMIT 20", c.get('workspace').id);
  return c.json({ items: items.map((i) => ({ ...i, config: parseJson(i.config, {}), enabled: Boolean(i.enabled) })), deliveries, events: WEBHOOK_EVENTS });
});

const webhookInput = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url().max(2048).refine((u) => u.startsWith('https://'), 'Webhook URLs must use https'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(10).default([]),
  enabled: z.boolean().default(true),
});

integrations.post('/webhooks', permission('workspace.manage'), async (c) => {
  const input = await body(c, webhookInput);
  const wid = c.get('workspace').id;
  await requireFeature(c.env.DB, wid, 'integrations');
  const id = newId('int');
  const secret = `whsec_${randomToken(24)}`;
  await run(c.env.DB, "INSERT INTO integrations (id, workspace_id, type, name, config, signing_secret, enabled) VALUES (?, ?, 'webhook', ?, ?, ?, ?)", id, wid, input.name, JSON.stringify({ url: input.url, events: input.events }), secret, input.enabled ? 1 : 0);
  await audit(c, 'integration.created', { type: 'integration', id }, { name: input.name });
  // The signing secret is shown once at creation.
  return c.json({ id, signingSecret: secret }, 201);
});

integrations.patch('/webhooks/:id', permission('workspace.manage'), async (c) => {
  const input = await body(c, webhookInput.partial());
  const wid = c.get('workspace').id;
  const cur = await first<{ config: string; name: string; enabled: number }>(c.env.DB, "SELECT config, name, enabled FROM integrations WHERE id = ? AND workspace_id = ? AND type = 'webhook'", c.req.param('id'), wid);
  if (!cur) throw notFound('Integration');
  const cfg = { ...parseJson<Record<string, unknown>>(cur.config, {}), ...(input.url ? { url: input.url } : {}), ...(input.events ? { events: input.events } : {}) };
  await run(c.env.DB, 'UPDATE integrations SET name = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ?', input.name ?? cur.name, JSON.stringify(cfg), input.enabled === undefined ? cur.enabled : input.enabled ? 1 : 0, nowIso(), c.req.param('id'));
  return c.json({ ok: true });
});

integrations.delete('/:id', permission('workspace.manage'), async (c) => {
  await run(c.env.DB, 'DELETE FROM integrations WHERE id = ? AND workspace_id = ?', c.req.param('id'), c.get('workspace').id);
  return c.json({ ok: true });
});

integrations.post('/webhooks/:id/test', permission('workspace.manage'), async (c) => {
  const wid = c.get('workspace').id;
  const exists = await first(c.env.DB, "SELECT 1 FROM integrations WHERE id = ? AND workspace_id = ? AND type = 'webhook'", c.req.param('id'), wid);
  if (!exists) throw notFound('Integration');
  await enqueueWebhooks(c.env, wid, 'webhook.test', { message: 'Test delivery from Invitely', integrationId: c.req.param('id') });
  return c.json({ queued: true });
});
