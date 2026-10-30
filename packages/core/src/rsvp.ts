import type { Answers } from './logic';
import { allElements, type FormSchema } from './schema';
import type { DietaryValue, GuestCountValue, PlusOneValue } from './validate';

export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'maybe';

export interface RsvpOutcome {
  status: RsvpStatus | null;
  /** expected attendees including the respondent */
  partySize: number;
  adults: number;
  children: number;
  meal?: string;
  dietary?: string;
  guestNames: string[];
  sessionOptionIds: string[];
  email?: string;
  name?: string;
  phone?: string;
}

/**
 * Derive normalized RSVP facts from a validated submission. Used by the API to update
 * event_guests and analytics; never trusts client-provided status fields.
 */
export function deriveRsvp(schema: FormSchema, answers: Answers): RsvpOutcome {
  const els = allElements(schema);
  const find = (type: string) => els.find((e) => e.type === type && answers[e.id] !== undefined);
  const out: RsvpOutcome = { status: null, partySize: 0, adults: 0, children: 0, guestNames: [], sessionOptionIds: [] };

  const att = find('attendance');
  if (att) {
    const v = answers[att.id];
    out.status = v === 'accept' ? 'accepted' : v === 'decline' ? 'declined' : v === 'maybe' ? 'maybe' : null;
  }
  const gc = find('guest_count');
  if (gc) {
    const v = answers[gc.id] as GuestCountValue;
    out.adults = v.adults;
    out.children = v.children;
  }
  const names = find('guest_names');
  if (names) out.guestNames = answers[names.id] as string[];
  const plus = find('plus_one');
  const plusVal = plus ? (answers[plus.id] as PlusOneValue) : undefined;

  if (out.status === 'accepted' || out.status === 'maybe') {
    if (!gc) out.adults = 1 + (plusVal?.bringing ? 1 : 0);
    if (out.adults + out.children === 0) out.adults = 1;
  } else {
    out.adults = 0;
    out.children = 0;
  }
  out.partySize = out.adults + out.children;

  const meal = find('meal_preference');
  if (meal) out.meal = String(answers[meal.id]);
  const diet = find('dietary');
  if (diet) {
    const d = answers[diet.id] as DietaryValue;
    out.dietary = [...d.restrictions, d.notes].filter(Boolean).join(', ');
  }
  const sel = find('event_selection');
  if (sel) out.sessionOptionIds = answers[sel.id] as string[];
  const email = find('email');
  if (email) out.email = String(answers[email.id]);
  const phone = find('phone');
  if (phone) out.phone = String(answers[phone.id]);
  const name = els.find((e) => e.type === 'short_text' && /name/i.test(e.id + e.label) && answers[e.id] !== undefined);
  if (name) out.name = String(answers[name.id]);
  return out;
}

/** Replace {{field_id}} placeholders with plain-text answers. */
export function interpolate(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    return v === undefined || v === null || typeof v === 'object' ? '' : String(v);
  });
}

export function slugify(input: string, maxLength = 60): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '') || 'form';
}
