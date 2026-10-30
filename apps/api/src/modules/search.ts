import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { all, likeEscape } from '../lib/db';
import { query } from '../lib/http';

/** Global dashboard search across forms, events and guests. */
export const search = new Hono<AppBindings>();

search.get('/', async (c) => {
  const q = query(c, z.object({ q: z.string().trim().min(1).max(100) }));
  const wid = c.get('workspace').id;
  const s = likeEscape(q.q);
  const [formsList, eventsList, guestsList] = await Promise.all([
    all(c.env.DB, "SELECT id, name, status FROM forms WHERE workspace_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 6", wid, s),
    all(c.env.DB, "SELECT id, name, status, starts_at FROM events WHERE workspace_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY starts_at DESC LIMIT 6", wid, s),
    all(c.env.DB, "SELECT id, name, email FROM guests WHERE workspace_id = ? AND deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name LIMIT 6", wid, s, s),
  ]);
  return c.json({ forms: formsList, events: eventsList, guests: guestsList });
});
