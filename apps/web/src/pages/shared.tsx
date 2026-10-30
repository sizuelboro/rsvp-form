import { Badge, type Tone } from '../components/ui';

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  published: { tone: 'success', label: 'Published' },
  closed: { tone: 'warning', label: 'Closed' },
  active: { tone: 'brand', label: 'Active' },
  completed: { tone: 'neutral', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

const RSVP: Record<string, { tone: Tone; label: string }> = {
  accepted: { tone: 'success', label: 'Accepted' },
  declined: { tone: 'danger', label: 'Declined' },
  maybe: { tone: 'warning', label: 'Maybe' },
  pending: { tone: 'neutral', label: 'Pending' },
};
export function RsvpBadge({ status }: { status: string }) {
  const s = RSVP[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const INVITE: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Link ready' },
  queued: { tone: 'brand', label: 'Queued' },
  sent: { tone: 'brand', label: 'Sent' },
  delivered: { tone: 'success', label: 'Delivered' },
  failed: { tone: 'danger', label: 'Failed' },
};
export function InviteBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-[12px] text-faint">Not invited</span>;
  const s = INVITE[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ACTIVITY: Record<string, string> = {
  'form.created': 'created a form', 'form.published': 'published a form', 'form.deleted': 'deleted a form', 'form.duplicated': 'duplicated a form',
  'form.settings_updated': 'updated form settings', 'form.version_restored': 'restored a form version', 'event.created': 'created an event',
  'event.updated': 'updated an event', 'event.deleted': 'deleted an event', 'event.invitation_sent': 'sent invitations', 'event.deadline_reminder_sent': 'sent RSVP reminders',
  'event.event_reminder_sent': 'sent event reminders', 'event.event_update': 'sent an event update', 'event.cancellation': 'cancelled an event',
  'event.guests_added': 'added guests to an event', 'event_guest.overridden': 'updated an RSVP manually', 'guests.imported': 'imported guests',
  'checkin.created': 'checked in a guest', 'checkin.undone': 'undid a check-in', 'member.invited': 'invited a teammate', 'member.removed': 'removed a teammate',
  'member.role_changed': 'changed a teammate’s role', 'submission.deleted': 'deleted a response', 'submissions.exported': 'exported responses',
  'workspace.updated': 'updated workspace settings', 'integration.created': 'added an integration', 'domain.added': 'added a custom domain',
};
export const activityLabel = (action: string) => ACTIVITY[action] ?? action.replace(/^[a-z_]+\./, '').replace(/_/g, ' ');

/** Option ids such as "non_vegetarian" → "Non vegetarian" when no label is available. */
export const humanize = (id: string | null | undefined) => (id ? id.replace(/^o_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
