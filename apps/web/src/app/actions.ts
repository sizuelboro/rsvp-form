import type { NavigateFunction } from 'react-router-dom';
import { post } from '../lib/api';
import { wpath } from '../stores/session';
import { toast } from '../stores/toast';

/** Creates a form (optionally from a template / for an event) and opens it in the editor. */
export async function createForm(navigate: NavigateFunction, opts: { kind?: 'form' | 'rsvp'; templateId?: string; eventId?: string; name?: string }) {
  try {
    const r = await post<{ id: string }>(wpath('/forms'), opts);
    navigate(`/forms/${r.id}/edit`);
  } catch (e) {
    toast.error(e);
  }
}
