import { Hono } from 'hono';
import { z } from 'zod';
import { slugify } from '@rsvp/core';
import type { AppBindings } from '../env';
import { createSession, destroySession, requireUser } from '../lib/auth';
import { hashPassword, newId, verifyPassword } from '../lib/crypto';
import { addDays, all, first, isUniqueViolation, nowIso, run } from '../lib/db';
import { ApiError, body, conflict } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { audit } from '../lib/audit';

export const auth = new Hono<AppBindings>();

const password = z.string().min(8, 'Use at least 8 characters').max(200);
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);

/** Creates a workspace with an owner membership and a trial subscription. */
export async function createWorkspace(db: D1Database, env: { TRIAL_PLAN: string; TRIAL_DAYS: string }, ownerId: string, name: string): Promise<string> {
  const id = newId('ws');
  const slug = `${slugify(name, 40)}-${id.slice(-6)}`;
  await db.batch([
    db.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(id, name, slug, ownerId),
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, ownerId),
    db.prepare("INSERT INTO subscriptions (id, workspace_id, plan_id, status, trial_plan_id, trial_ends_at) VALUES (?, ?, 'free', 'active', ?, ?)")
      .bind(newId('sub'), id, env.TRIAL_PLAN || null, env.TRIAL_PLAN ? addDays(Number(env.TRIAL_DAYS || 14)) : null),
  ]);
  return id;
}

auth.post('/signup', rateLimit('signup', 10, 3600), async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(120), email, password, workspaceName: z.string().trim().min(1).max(120).optional() }));
  const id = newId('usr');
  try {
    await run(c.env.DB, 'INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)', id, input.email, input.name, await hashPassword(input.password));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('An account with this email already exists');
    throw e;
  }
  const wid = await createWorkspace(c.env.DB, c.env, id, input.workspaceName ?? `${input.name.split(' ')[0]}'s workspace`);
  await createSession(c, id);
  c.set('user', { id, email: input.email, name: input.name });
  await audit(c, 'user.signup', { type: 'user', id }, {}, wid);
  return c.json({ user: { id, email: input.email, name: input.name }, workspaceId: wid }, 201);
});

auth.post('/login', rateLimit('login', 20, 900), async (c) => {
  const input = await body(c, z.object({ email, password: z.string().min(1).max(200) }));
  const user = await first<{ id: string; name: string; password_hash: string }>(c.env.DB, 'SELECT id, name, password_hash FROM users WHERE email = ? AND deleted_at IS NULL', input.email);
  // Always run a hash comparison to keep timing similar for unknown emails.
  const valid = user ? await verifyPassword(input.password, user.password_hash) : (await hashPassword(input.password), false);
  if (!user || !valid) throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  await createSession(c, user.id);
  return c.json({ user: { id: user.id, email: input.email, name: user.name } });
});

auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

auth.get('/me', requireUser, async (c) => {
  const user = c.get('user')!;
  const workspaces = await all<{ id: string; name: string; slug: string; role: string }>(
    c.env.DB,
    `SELECT w.id, w.name, w.slug, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = ? AND w.deleted_at IS NULL ORDER BY w.created_at`, user.id);
  return c.json({ user, workspaces });
});

auth.patch('/me', requireUser, async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(120).optional(), currentPassword: z.string().max(200).optional(), newPassword: password.optional() }));
  const user = c.get('user')!;
  if (input.name) await run(c.env.DB, 'UPDATE users SET name = ?, updated_at = ? WHERE id = ?', input.name, nowIso(), user.id);
  if (input.newPassword) {
    const row = await first<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!row || !input.currentPassword || !(await verifyPassword(input.currentPassword, row.password_hash))) throw new ApiError(401, 'invalid_credentials', 'Current password is incorrect');
    await run(c.env.DB, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(input.newPassword), nowIso(), user.id);
    await run(c.env.DB, 'DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, c.get('sessionId'));
  }
  return c.json({ ok: true });
});

/** GDPR-style export of everything the user owns. */
auth.get('/me/export', requireUser, async (c) => {
  const user = c.get('user')!;
  const owned = await all<{ id: string }>(c.env.DB, "SELECT workspace_id AS id FROM workspace_members WHERE user_id = ? AND role = 'owner'", user.id);
  const workspaces = [];
  for (const { id } of owned) {
    workspaces.push({
      workspace: await first(c.env.DB, 'SELECT id, name, slug, created_at FROM workspaces WHERE id = ?', id),
      forms: await all(c.env.DB, 'SELECT id, name, slug, status, draft_schema, created_at FROM forms WHERE workspace_id = ? AND deleted_at IS NULL', id),
      events: await all(c.env.DB, 'SELECT * FROM events WHERE workspace_id = ? AND deleted_at IS NULL', id),
      guests: await all(c.env.DB, 'SELECT id, name, email, phone, notes, attributes, created_at FROM guests WHERE workspace_id = ? AND deleted_at IS NULL', id),
      submissions: await all(c.env.DB, 'SELECT id, form_id, data, created_at FROM submissions WHERE workspace_id = ? AND deleted_at IS NULL', id),
    });
  }
  await audit(c, 'user.export', { type: 'user', id: user.id });
  return new Response(JSON.stringify({ exportedAt: nowIso(), user, workspaces }, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="invitely-export.json"' },
  });
});

/** Account deletion: soft-deletes the user and every workspace they solely own; sessions are revoked. */
auth.delete('/me', requireUser, async (c) => {
  const input = await body(c, z.object({ password: z.string().min(1).max(200) }));
  const user = c.get('user')!;
  const row = await first<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!row || !(await verifyPassword(input.password, row.password_hash))) throw new ApiError(401, 'invalid_credentials', 'Password is incorrect');
  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE workspaces SET deleted_at = ? WHERE owner_id = ? AND deleted_at IS NULL").bind(ts, user.id),
    c.env.DB.prepare("UPDATE users SET deleted_at = ?, email = id || '@deleted.invalid', name = 'Deleted user' WHERE id = ?").bind(ts, user.id),
    c.env.DB.prepare('DELETE FROM workspace_members WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  await audit(c, 'user.deleted', { type: 'user', id: user.id });
  await destroySession(c);
  return c.json({ ok: true });
});

/** Accept a workspace invitation (the invitee must be signed in with the invited email). */
auth.post('/workspace-invitations/:token/accept', requireUser, async (c) => {
  const user = c.get('user')!;
  const inv = await first<{ id: string; workspace_id: string; email: string; role: string; expires_at: string; accepted_at: string | null }>(
    c.env.DB, 'SELECT id, workspace_id, email, role, expires_at, accepted_at FROM invitations_to_workspace WHERE token = ?', c.req.param('token'));
  if (!inv || inv.accepted_at || inv.expires_at < nowIso()) throw new ApiError(410, 'invitation_invalid', 'This invitation is no longer valid');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new ApiError(403, 'forbidden', 'This invitation was sent to a different email address');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(inv.workspace_id, user.id, inv.role),
    c.env.DB.prepare('UPDATE invitations_to_workspace SET accepted_at = ? WHERE id = ?').bind(nowIso(), inv.id),
  ]);
  return c.json({ workspaceId: inv.workspace_id });
});
