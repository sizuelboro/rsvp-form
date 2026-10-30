import { COUNTRY_CODES } from './countries';
import { FIELD_DEFINITIONS } from './fields';
import { evaluateLogic, isEmptyValue, type Answers, type LogicState } from './logic';
import type { FormElement, FormSchema } from './schema';

export interface FileRef { key: string; name: string; size: number; type: string }
export interface GuestCountValue { adults: number; children: number }
export interface PlusOneValue { bringing: boolean; name?: string }
export interface DietaryValue { restrictions: string[]; notes?: string }
export interface AddressValue { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
  /** sanitized answers containing only visible input fields */
  cleaned: Answers;
  state: LogicState;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARS_RE = /^\+?[0-9\s().-]{7,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SIGNATURE_RE = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const UPLOAD_KEY_RE = /^uploads\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;

type Check = { value?: unknown; error?: string };

const ok = (value: unknown): Check => ({ value });
const fail = (error: string): Check => ({ error });

function str(v: unknown, max: number): string | null {
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > max ? null : t;
}

function optionIds(el: FormElement): Set<string> {
  return new Set((el.config.options ?? []).map((o) => o.id));
}

function checkChoice(el: FormElement, v: unknown): Check {
  const s = str(v, 200);
  if (s === null) return fail('Choose a valid option');
  if (s === '') return ok(undefined);
  if (optionIds(el).has(s)) return ok(s);
  if (el.config.allowOther) return ok(s);
  return fail('Choose a valid option');
}

function checkList(el: FormElement, v: unknown, ids: Set<string>, allowOther: boolean): Check {
  if (!Array.isArray(v)) return fail('Choose valid options');
  const out: string[] = [];
  for (const item of v) {
    const s = str(item, 200);
    if (s === null || s === '') continue;
    if (!ids.has(s) && !allowOther) return fail('Choose valid options');
    if (!out.includes(s)) out.push(s);
  }
  const { minSelections, maxSelections } = el.config;
  if (out.length && minSelections && out.length < minSelections) return fail(`Select at least ${minSelections}`);
  if (maxSelections && out.length > maxSelections) return fail(`Select at most ${maxSelections}`);
  return ok(out.length ? out : undefined);
}

function checkText(el: FormElement, v: unknown, hardMax: number): Check {
  const s = str(v, Math.max(hardMax, el.config.maxLength ?? 0));
  if (s === null) return fail(`Must be at most ${el.config.maxLength ?? hardMax} characters`);
  if (s === '') return ok(undefined);
  const { minLength, maxLength, pattern } = el.config;
  if (minLength && s.length < minLength) return fail(`Must be at least ${minLength} characters`);
  if (maxLength && s.length > maxLength) return fail(`Must be at most ${maxLength} characters`);
  if (pattern === 'letters' && !/^[\p{L}\s'.-]+$/u.test(s)) return fail('Use letters only');
  if (pattern === 'alphanumeric' && !/^[\p{L}\p{N}\s]+$/u.test(s)) return fail('Use letters and numbers only');
  if (pattern === 'digits' && !/^\d+$/.test(s)) return fail('Use digits only');
  return ok(s);
}

function toInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
}

export function validateElementValue(el: FormElement, raw: unknown): Check {
  if (raw === undefined || raw === null) return ok(undefined);
  const c = el.config;
  switch (el.type) {
    case 'short_text': return checkText(el, raw, 500);
    case 'long_text': return checkText(el, raw, 10000);
    case 'hidden': {
      const s = str(raw, 500);
      return s === null ? fail('Invalid value') : ok(s || undefined);
    }
    case 'email': {
      const s = str(raw, 254);
      if (s === null) return fail('Enter a valid email address');
      if (s === '') return ok(undefined);
      return EMAIL_RE.test(s) ? ok(s.toLowerCase()) : fail('Enter a valid email address');
    }
    case 'phone': {
      const s = str(raw, 24);
      if (s === null) return fail('Enter a valid phone number');
      if (s === '') return ok(undefined);
      const digits = s.replace(/\D/g, '');
      return PHONE_CHARS_RE.test(s) && digits.length >= 7 && digits.length <= 15 ? ok(s) : fail('Enter a valid phone number');
    }
    case 'website': {
      let s = str(raw, 2048);
      if (s === null) return fail('Enter a valid URL');
      if (s === '') return ok(undefined);
      if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
      try {
        const u = new URL(s);
        return u.hostname.includes('.') ? ok(u.toString()) : fail('Enter a valid URL');
      } catch { return fail('Enter a valid URL'); }
    }
    case 'date': {
      const s = str(raw, 10);
      if (s === null) return fail('Enter a valid date');
      if (s === '') return ok(undefined);
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return fail('Enter a valid date');
      return ok(s);
    }
    case 'time': {
      const s = str(raw, 5);
      if (s === null) return fail('Enter a valid time');
      if (s === '') return ok(undefined);
      return TIME_RE.test(s) ? ok(s) : fail('Enter a valid time');
    }
    case 'number': {
      if (raw === '') return ok(undefined);
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return fail('Enter a number');
      if (c.min !== undefined && n < c.min) return fail(`Must be at least ${c.min}`);
      if (c.max !== undefined && n > c.max) return fail(`Must be at most ${c.max}`);
      if (c.step && Math.abs(Math.round((n - (c.min ?? 0)) / c.step) * c.step - (n - (c.min ?? 0))) > 1e-9) return fail(`Must be in steps of ${c.step}`);
      return ok(n);
    }
    case 'rating': {
      const n = toInt(raw);
      const scale = c.scale ?? 5;
      if (n === null || n < 1 || n > scale) return fail(`Choose a rating from 1 to ${scale}`);
      return ok(n);
    }
    case 'single_choice': case 'dropdown': case 'meal_preference': case 'accommodation': case 'transportation':
      return checkChoice(el, raw);
    case 'yes_no': {
      const s = str(raw, 3);
      if (s === '') return ok(undefined);
      return s === 'yes' || s === 'no' ? ok(s) : fail('Choose yes or no');
    }
    case 'attendance': {
      const s = str(raw, 10);
      if (s === '') return ok(undefined);
      const allowed = c.allowMaybe ? ['accept', 'decline', 'maybe'] : ['accept', 'decline'];
      return s && allowed.includes(s) ? ok(s) : fail('Let us know if you can attend');
    }
    case 'country': {
      const s = str(raw, 2);
      if (s === '') return ok(undefined);
      return s && COUNTRY_CODES.has(s.toUpperCase()) ? ok(s.toUpperCase()) : fail('Choose a country');
    }
    case 'multiple_choice': return checkList(el, raw, optionIds(el), Boolean(c.allowOther));
    case 'event_selection': return checkList(el, raw, optionIds(el), false);
    case 'image_choice': {
      const res = checkList(el, Array.isArray(raw) ? raw : [raw], optionIds(el), false);
      if (res.error) return res;
      const list = (res.value as string[] | undefined) ?? [];
      if (!c.multiple && list.length > 1) return fail('Choose one option');
      return res;
    }
    case 'guest_names': {
      if (!Array.isArray(raw)) return fail('Enter guest names');
      const names = raw.map((n) => str(n, 120)).filter((n): n is string => n !== null && n !== '');
      if (names.length !== raw.filter((n) => typeof n === 'string' && n.trim()).length) return fail('Names must be under 120 characters');
      if (c.maxGuests && names.length > c.maxGuests) return fail(`Enter at most ${c.maxGuests} names`);
      return ok(names.length ? names : undefined);
    }
    case 'guest_count': {
      const v = typeof raw === 'number' || typeof raw === 'string' ? { adults: raw, children: 0 } : (raw as Record<string, unknown>);
      if (typeof v !== 'object' || v === null) return fail('Enter the number of guests');
      if ((v.adults === '' || v.adults === undefined) && !v.children) return ok(undefined);
      const adults = toInt(v.adults ?? 0);
      const children = c.splitAdultsChildren ? toInt(v.children ?? 0) : 0;
      if (adults === null || children === null || adults < 0 || children < 0) return fail('Enter a whole number');
      const total = adults + children;
      if (c.minGuests !== undefined && total < c.minGuests) return fail(`At least ${c.minGuests} guest${c.minGuests === 1 ? '' : 's'}`);
      if (c.maxGuests !== undefined && total > c.maxGuests) return fail(`At most ${c.maxGuests} guests`);
      return ok({ adults, children } satisfies GuestCountValue);
    }
    case 'plus_one': {
      const v = raw as Record<string, unknown>;
      if (typeof v !== 'object' || v === null || v.bringing === undefined) return ok(undefined);
      if (typeof v.bringing !== 'boolean') return fail('Choose an option');
      const name = v.bringing ? str(v.name ?? '', 120) : '';
      if (name === null) return fail('Name must be under 120 characters');
      return ok(name ? { bringing: v.bringing, name } : { bringing: v.bringing });
    }
    case 'dietary': {
      const v = raw as Record<string, unknown>;
      if (typeof v !== 'object' || v === null) return fail('Invalid value');
      const list = checkList({ ...el, config: { ...c, minSelections: undefined, maxSelections: undefined } }, v.restrictions ?? [], optionIds(el), false);
      if (list.error) return list;
      const notes = str(v.notes ?? '', 1000);
      if (notes === null) return fail('Notes must be under 1000 characters');
      const restrictions = (list.value as string[] | undefined) ?? [];
      if (!restrictions.length && !notes) return ok(undefined);
      return ok(notes ? { restrictions, notes } : { restrictions });
    }
    case 'address': {
      const v = raw as Record<string, unknown>;
      if (typeof v !== 'object' || v === null) return fail('Invalid address');
      const out: AddressValue = {};
      for (const k of ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const) {
        const s = str(v[k] ?? '', 200);
        if (s === null) return fail('Address lines must be under 200 characters');
        if (s) out[k] = s;
      }
      if (!Object.keys(out).length) return ok(undefined);
      if (el.required && (!out.line1 || !out.city)) return fail('Enter street address and city');
      return ok(out);
    }
    case 'signature': {
      if (raw === '') return ok(undefined);
      if (typeof raw !== 'string' || raw.length > 300_000 || !SIGNATURE_RE.test(raw)) return fail('Invalid signature');
      return ok(raw);
    }
    case 'file_upload': {
      if (!Array.isArray(raw)) return fail('Invalid upload');
      const max = c.maxFiles ?? 1;
      if (raw.length > max) return fail(`Upload at most ${max} file${max === 1 ? '' : 's'}`);
      const files: FileRef[] = [];
      for (const f of raw as Record<string, unknown>[]) {
        if (!f || typeof f.key !== 'string' || !UPLOAD_KEY_RE.test(f.key)) return fail('Invalid upload');
        const size = Number(f.size);
        if (!Number.isFinite(size) || size <= 0 || size > (c.maxFileSizeMb ?? 10) * 1024 * 1024) return fail('File is too large');
        files.push({ key: f.key, name: String(f.name ?? 'file').slice(0, 200), size, type: String(f.type ?? '').slice(0, 100) });
      }
      return ok(files.length ? files : undefined);
    }
    case 'payment':
      // Client cannot set payment state; the server records intent from the schema config.
      return ok(undefined);
    default:
      return ok(undefined);
  }
}

export interface ValidateOptions {
  /** Only validate elements on these page indexes (per-step validation) */
  pages?: number[];
  /** Hidden-field query parameters available to the renderer/server */
  query?: Record<string, string>;
}

/**
 * Validate and sanitize answers against a schema. Hidden fields (by logic or page path) are
 * dropped so the stored submission contains exactly what the respondent was asked.
 */
export function validateAnswers(schema: FormSchema, answers: Answers, options: ValidateOptions = {}): ValidationResult {
  const state = evaluateLogic(schema, answers);
  const errors: Record<string, string> = {};
  const cleaned: Answers = {};
  schema.pages.forEach((page, pi) => {
    const inScope = !options.pages || options.pages.includes(pi);
    for (const el of page.elements) {
      const def = FIELD_DEFINITIONS[el.type];
      if (!def.isInput || state.hidden.has(el.id)) continue;
      let raw = answers[el.id];
      if (el.type === 'hidden') {
        if (el.config.source === 'static') raw = el.defaultValue;
        else if (raw === undefined && el.config.queryParam) raw = options.query?.[el.config.queryParam];
      }
      if (el.type === 'payment') {
        cleaned[el.id] = { status: 'pending', amount: el.config.amount ?? 0, currency: el.config.currency ?? 'INR' };
        continue;
      }
      const res = validateElementValue(el, raw);
      if (res.error) {
        if (inScope) errors[el.id] = res.error;
        continue;
      }
      const required = state.required.get(el.id) ?? false;
      if (required && isEmptyValue(res.value)) {
        if (inScope) errors[el.id] = el.type === 'attendance' ? 'Let us know if you can attend' : 'This field is required';
        continue;
      }
      if (res.value !== undefined) cleaned[el.id] = res.value;
    }
  });
  return { ok: Object.keys(errors).length === 0, errors, cleaned, state };
}

/** Human readable rendering of a stored answer, used by exports, emails and the response viewer. */
export function formatAnswer(el: FormElement | undefined, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (!el) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  const label = (id: string) => el.config.options?.find((o) => o.id === id)?.label ?? id;
  switch (el.type) {
    case 'single_choice': case 'dropdown': case 'meal_preference': case 'accommodation': case 'transportation':
      return label(String(value));
    case 'multiple_choice': case 'image_choice': case 'event_selection':
      return (Array.isArray(value) ? value : [value]).map((v) => label(String(v))).join(', ');
    case 'yes_no': return value === 'yes' ? 'Yes' : 'No';
    case 'attendance':
      return value === 'accept' ? (el.config.acceptLabel ?? 'Accept') : value === 'decline' ? (el.config.declineLabel ?? 'Decline') : (el.config.maybeLabel ?? 'Maybe');
    case 'guest_count': {
      const v = value as GuestCountValue;
      return el.config.splitAdultsChildren ? `${v.adults} adults, ${v.children} children` : String(v.adults + v.children);
    }
    case 'guest_names': return (value as string[]).join(', ');
    case 'plus_one': {
      const v = value as PlusOneValue;
      return v.bringing ? `Yes${v.name ? ` (${v.name})` : ''}` : 'No';
    }
    case 'dietary': {
      const v = value as DietaryValue;
      return [v.restrictions.map(label).join(', '), v.notes].filter(Boolean).join(' — ');
    }
    case 'address': return Object.values(value as AddressValue).filter(Boolean).join(', ');
    case 'file_upload': return (value as FileRef[]).map((f) => f.name).join(', ');
    case 'signature': return '[signature]';
    case 'payment': {
      const v = value as { status: string; amount: number; currency: string };
      return `${v.currency} ${v.amount} (${v.status})`;
    }
    default: return String(value);
  }
}
