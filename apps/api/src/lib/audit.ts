import type { Context } from 'hono';
import type { AppBindings } from '../env';
import { newId } from './crypto';

export async function audit(
  c: Context<AppBindings>,
  action: string,
  entity?: { type: string; id: string },
  data: Record<string, unknown> = {},
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? (c.get('workspace') as { id: string } | undefined)?.id ?? null;
  await c.env.DB.prepare('INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('aud'), ws, c.get('user')?.id ?? null, action, entity?.type ?? null, entity?.id ?? null, JSON.stringify(data))
    .run();
}
