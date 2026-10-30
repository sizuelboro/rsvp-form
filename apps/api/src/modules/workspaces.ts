import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { permission, requireUser } from '../lib/auth';
import { newId, randomToken } from '../lib/crypto';
import { addDays, all, first, isUniqueViolation, nowIso, run } from '../lib/db';
import { ApiError, body, conflict, notFound, parseJson } from '../lib/http';
import { getEntitlements, requireFeature, requireWithinLimit, usage } from '../lib/entitlements';
import { audit } from '../lib/audit';
import { createWorkspace } from './auth';
import { enqueueEmail } from './notifications';

/** Routes mounted at /api/v1/workspaces (not workspace-scoped) */
export const workspacesRoot = new Hono<AppBindings>();

workspacesRoot.post('/', requireUser, async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(120) }));
  const user = c.get('user')!;
  const owned = await all<{ workspace_id: string }>(c.env.DB, "SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role = 'owner'", user.id);
  let maxWorkspaces = 1;
  for (const o of owned) maxWorkspaces = Math.max(maxWorkspaces, (await getEntitlements(c.env.DB, o.workspace_id)).limits.workspaces);
  if (owned.length >= maxWorkspaces) throw new ApiError(402, 'limit_reached', `Your plan allows ${maxWorkspaces} workspace${maxWorkspaces === 1 ? '' : 's'}`);
  const id = await createWorkspace(c.env.DB, c.env, user.id, input.name);
  await audit(c, 'workspace.created', { type: 'workspace', id }, {}, id);
  return c.json({ id }, 201);
});

/** Routes mounted at /api/v1/w/:wid */
export const workspace = new Hono<AppBindings>();

workspace.get('/', async (c) => {
  const { id, role } = c.get('workspace');
  const ws = await first<{ id: string; name: string; slug: string; branding: string; created_at: string }>(c.env.DB, 'SELECT id, name, slug, branding, created_at FROM workspaces WHERE id = ?', id);
  if (!ws) throw notFound('Workspace');
  const ent = await getEntitlements(c.env.DB, id);
  const [forms, events, guests, members, monthlySubmissions] = await Promise.all([
    usage(c.env.DB, id, 'forms'), usage(c.env.DB, id, 'events'), usage(c.env.DB, id, 'guests'), usage(c.env.DB, id, 'members'), usage(c.env.DB, id, 'monthlySubmissions'),
  ]);
  return c.json({ ...ws, branding: parseJson(ws.branding, {}), role, entitlements: ent, usage: { forms, events, guests, members, monthlySubmissions } });
});

workspace.patch('/', permission('workspace.manage'), async (c) => {
  const input = await body(c, z.object({
    name: z.string().trim().min(1).max(120).optional(),
    branding: z.object({ logoUrl: z.string().url().max(2048).optional().or(z.literal('')), primaryColor: z.string().max(32).optional(), hideBranding: z.boolean().optional() }).optional(),
  }));
  const { id } = c.get('workspace');
  if (input.branding?.hideBranding) await requireFeature(c.env.DB, id, 'customBranding');
  if (input.name) await run(c.env.DB, 'UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?', input.name, nowIso(), id);
  if (input.branding) await run(c.env.DB, 'UPDATE workspaces SET branding = ?, updated_at = ? WHERE id = ?', JSON.stringify(input.branding), nowIso(), id);
  await audit(c, 'workspace.updated', { type: 'workspace', id }, input);
  return c.json({ ok: true });
});

workspace.delete('/', permission('billing.manage'), async (c) => {
  const { id } = c.get('workspace');
  await run(c.env.DB, 'UPDATE workspaces SET deleted_at = ? WHERE id = ?', nowIso(), id);
  await audit(c, 'workspace.deleted', { type: 'workspace', id });
  return c.json({ ok: true });
});

// ─── Members ───
workspace.get('/members', async (c) => {
  const { id } = c.get('workspace');
  const members = await all(c.env.DB, `SELECT u.id, u.name, u.email, m.role, m.created_at FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at`, id);
  const pending = await all(c.env.DB, 'SELECT id, email, role, expires_at, created_at FROM invitations_to_workspace WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC', id, nowIso());
  return c.json({ members, pending });
});

workspace.post('/members/invite', permission('members.manage'), async (c) => {
  const input = await body(c, z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['admin', 'editor', 'viewer']) }));
  const { id } = c.get('workspace');
  await requireFeature(c.env.DB, id, 'teamCollaboration');
  await requireWithinLimit(c.env.DB, id, 'members');
  const existing = await first(c.env.DB, 'SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?', id, input.email);
  if (existing) throw conflict('This person is already a member');
  const token = randomToken();
  const invId = newId('wsi');
  await run(c.env.DB, 'INSERT INTO invitations_to_workspace (id, workspace_id, email, role, token, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', invId, id, input.email, input.role, token, c.get('user')!.id, addDays(7));
  const ws = await first<{ name: string }>(c.env.DB, 'SELECT name FROM workspaces WHERE id = ?', id);
  await enqueueEmail(c.env, {
    workspaceId: id, type: 'workspace_invitation', to: input.email,
    subject: `${c.get('user')!.name} invited you to ${ws?.name ?? 'a workspace'}`,
    vars: { inviter: c.get('user')!.name, workspace: ws?.name ?? '', link: `${c.env.APP_URL}/join/${token}` },
    idempotencyKey: `wsi:${invId}`,
  });
  await audit(c, 'member.invited', { type: 'invitation', id: invId }, { email: input.email, role: input.role });
  return c.json({ id: invId }, 201);
});

workspace.patch('/members/:userId', permission('members.manage'), async (c) => {
  const input = await body(c, z.object({ role: z.enum(['admin', 'editor', 'viewer']) }));
  const { id } = c.get('workspace');
  const target = await first<{ role: string }>(c.env.DB, 'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', id, c.req.param('userId'));
  if (!target) throw notFound('Member');
  if (target.role === 'owner') throw new ApiError(403, 'forbidden', 'The owner’s role cannot be changed');
  await run(c.env.DB, 'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?', input.role, id, c.req.param('userId'));
  await audit(c, 'member.role_changed', { type: 'user', id: c.req.param('userId') }, input);
  return c.json({ ok: true });
});

workspace.delete('/members/:userId', permission('members.manage'), async (c) => {
  const { id } = c.get('workspace');
  const target = await first<{ role: string }>(c.env.DB, 'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', id, c.req.param('userId'));
  if (!target) throw notFound('Member');
  if (target.role === 'owner') throw new ApiError(403, 'forbidden', 'The owner cannot be removed');
  await run(c.env.DB, 'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', id, c.req.param('userId'));
  await audit(c, 'member.removed', { type: 'user', id: c.req.param('userId') });
  return c.json({ ok: true });
});

// ─── Custom domains (foundation: DNS TXT verification record) ───
workspace.get('/domains', async (c) => {
  return c.json({ items: await all(c.env.DB, 'SELECT id, hostname, status, verification_token, verified_at, created_at FROM custom_domains WHERE workspace_id = ?', c.get('workspace').id) });
});

workspace.post('/domains', permission('workspace.manage'), async (c) => {
  const input = await body(c, z.object({ hostname: z.string().trim().toLowerCase().max(253).regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter a valid hostname such as rsvp.example.com') }));
  const { id } = c.get('workspace');
  await requireFeature(c.env.DB, id, 'customDomain');
  const domainId = newId('dom');
  try {
    await run(c.env.DB, 'INSERT INTO custom_domains (id, workspace_id, hostname, verification_token) VALUES (?, ?, ?, ?)', domainId, id, input.hostname, `invitely-verify=${randomToken(12)}`);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('This domain is already connected');
    throw e;
  }
  await audit(c, 'domain.added', { type: 'domain', id: domainId }, input);
  return c.json({ id: domainId }, 201);
});

/** Verify ownership via a DNS TXT lookup over DNS-over-HTTPS. */
workspace.post('/domains/:domainId/verify', permission('workspace.manage'), async (c) => {
  const { id } = c.get('workspace');
  const d = await first<{ hostname: string; verification_token: string }>(c.env.DB, 'SELECT hostname, verification_token FROM custom_domains WHERE id = ? AND workspace_id = ?', c.req.param('domainId'), id);
  if (!d) throw notFound('Domain');
  let verified = false;
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=_invitely.${d.hostname}&type=TXT`, { headers: { accept: 'application/dns-json' } });
    const json = (await res.json()) as { Answer?: { data: string }[] };
    verified = (json.Answer ?? []).some((a) => a.data.replace(/"/g, '') === d.verification_token);
  } catch {
    verified = false;
  }
  await run(c.env.DB, 'UPDATE custom_domains SET status = ?, verified_at = ? WHERE id = ?', verified ? 'verified' : 'failed', verified ? nowIso() : null, c.req.param('domainId'));
  return c.json({ verified });
});

workspace.delete('/domains/:domainId', permission('workspace.manage'), async (c) => {
  await run(c.env.DB, 'DELETE FROM custom_domains WHERE id = ? AND workspace_id = ?', c.req.param('domainId'), c.get('workspace').id);
  return c.json({ ok: true });
});

workspace.get('/audit-logs', permission('workspace.manage'), async (c) => {
  const items = await all(c.env.DB, `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 100`, c.get('workspace').id);
  return c.json({ items });
});

/** Activity feed for the dashboard (non-admin friendly subset of audit logs). */
workspace.get('/activity', async (c) => {
  const items = await all(c.env.DB, `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.workspace_id = ? AND a.action NOT LIKE 'user.%' ORDER BY a.created_at DESC LIMIT 20`, c.get('workspace').id);
  return c.json({ items });
});
