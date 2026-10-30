import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppBindings, Role } from '../env';
import { ApiError, forbidden } from './http';
import { randomToken, sha256 } from './crypto';
import { addDays, first, nowIso, run } from './db';

export const SESSION_COOKIE = 'inv_session';
const SESSION_DAYS = 30;

export type Permission =
  | 'content.read' | 'content.write' | 'responses.delete' | 'checkin'
  | 'workspace.manage' | 'members.manage' | 'billing.manage' | 'invitations.send';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['content.read', 'content.write', 'responses.delete', 'checkin', 'workspace.manage', 'members.manage', 'billing.manage', 'invitations.send'],
  admin: ['content.read', 'content.write', 'responses.delete', 'checkin', 'workspace.manage', 'members.manage', 'invitations.send'],
  editor: ['content.read', 'content.write', 'responses.delete', 'checkin', 'invitations.send'],
  viewer: ['content.read'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export async function createSession(c: Context<AppBindings>, userId: string): Promise<void> {
  const token = randomToken(32);
  const id = await sha256(token);
  await run(c.env.DB, 'INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)', id, userId, addDays(SESSION_DAYS), (c.req.header('user-agent') ?? '').slice(0, 300));
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}

export async function destroySession(c: Context<AppBindings>): Promise<void> {
  const sid = c.get('sessionId');
  if (sid) await run(c.env.DB, 'DELETE FROM sessions WHERE id = ?', sid);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** Loads the user for every request; does not reject anonymous requests. */
export const loadSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  c.set('user', null);
  c.set('sessionId', null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token && token.length < 100) {
    const id = await sha256(token);
    const row = await first<{ user_id: string; expires_at: string; email: string; name: string }>(
      c.env.DB,
      `SELECT s.user_id, s.expires_at, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND u.deleted_at IS NULL`, id);
    if (row && row.expires_at > nowIso()) {
      c.set('user', { id: row.user_id, email: row.email, name: row.name });
      c.set('sessionId', id);
    }
  }
  await next();
};

/**
 * CSRF defence in depth: the session cookie is SameSite=Lax (so cross-site POSTs carry no
 * cookie), and every state-changing authenticated request must also carry a custom header
 * that cannot be set by cross-origin HTML forms.
 */
export const requireCsrfHeader: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-requested-with') !== 'invitely') {
    throw new ApiError(403, 'csrf', 'Missing X-Requested-With header');
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get('user')) throw new ApiError(401, 'unauthenticated', 'Please sign in');
  await next();
};

/** Resolves :wid and verifies membership. Every tenant query must use c.get('workspace').id. */
export const requireWorkspace: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get('user');
  if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in');
  const wid = c.req.param('wid');
  if (!wid) throw forbidden();
  const m = await first<{ role: Role }>(
    c.env.DB,
    'SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.workspace_id = ? AND m.user_id = ? AND w.deleted_at IS NULL',
    wid, user.id);
  // Respond 404 rather than 403 so workspace ids cannot be probed.
  if (!m) throw new ApiError(404, 'not_found', 'Workspace not found');
  c.set('workspace', { id: wid, role: m.role });
  await next();
};

export function requirePermission(c: Context<AppBindings>, permission: Permission): void {
  if (!can(c.get('workspace').role, permission)) throw forbidden();
}

export function permission(p: Permission): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    requirePermission(c, p);
    await next();
  };
}
