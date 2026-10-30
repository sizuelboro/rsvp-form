import { describe, expect, it } from 'vitest';
import {
  TEMPLATES, THEME_PRESETS, blankRsvpSchema, blankSchema, buildSchema, checkIntegrity, createElement, deriveRsvp,
  evaluateLogic, formatAnswer, getTemplate, interpolate, migrateSchema, nextPageIndex, parseFormSchema, resolveTheme,
  slugify, templateElement as el, validateAnswers, FIELD_TYPES, FIELD_DEFINITIONS, type FormSchema,
} from '../src/index';

const wedding = () => structuredClone(getTemplate('wedding-classic')!.schema);

describe('templates', () => {
  it('ships 20 templates that all pass schema validation and integrity checks', () => {
    expect(TEMPLATES).toHaveLength(20);
    for (const tpl of TEMPLATES) {
      const res = parseFormSchema(tpl.schema);
      expect(res.ok, `${tpl.id}: ${JSON.stringify(!res.ok && res.issues)}`).toBe(true);
    }
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(20);
  });
  it('covers all 17 categories', () => {
    expect(new Set(TEMPLATES.map((t) => t.category)).size).toBe(17);
  });
  it('blank schemas are valid', () => {
    expect(parseFormSchema(blankSchema()).ok).toBe(true);
    expect(parseFormSchema(blankRsvpSchema()).ok).toBe(true);
  });
});

describe('field registry', () => {
  it('has a definition with valid defaults for every field type', () => {
    for (const type of FIELD_TYPES) {
      const def = FIELD_DEFINITIONS[type];
      expect(def.type).toBe(type);
      const schema = buildSchema({ title: 't', pages: [{ id: 'p', elements: [createElement(type, [])] }] });
      expect(parseFormSchema(schema).ok, type).toBe(true);
    }
  });
  it('generates unique ids', () => {
    const a = createElement('email', []);
    const b = createElement('email', [a.id]);
    expect(a.id).toBe('email_1');
    expect(b.id).toBe('email_2');
  });
});

describe('integrity', () => {
  it('detects duplicate ids and dangling logic references', () => {
    const s = buildSchema({
      title: 't',
      pages: [{ id: 'p', elements: [el('short_text', 'a'), el('short_text', 'a')] }],
      logic: [{ id: 'r', combinator: 'and', conditions: [{ fieldId: 'missing', operator: 'is_empty' }], actions: [{ type: 'show', target: 'nope' }] }],
    });
    const issues = checkIntegrity(s).map((i) => i.message).join('|');
    expect(issues).toContain('Duplicate element id');
    expect(issues).toContain('Unknown field "missing"');
    expect(issues).toContain('unknown field');
  });
  it('rejects invalid field ids', () => {
    const s = blankSchema() as unknown as { pages: { elements: { id: string }[] }[] };
    s.pages[0]!.elements[0]!.id = 'Bad Id';
    expect(parseFormSchema(s).ok).toBe(false);
  });
});

describe('logic engine', () => {
  it('hides accept-only fields until attendance is accept', () => {
    const s = wedding();
    const none = evaluateLogic(s, {});
    expect(none.hidden.has('guest_count')).toBe(true);
    expect(none.hidden.has('decline_message')).toBe(true);
    const yes = evaluateLogic(s, { attendance: 'accept' });
    expect(yes.hidden.has('guest_count')).toBe(false);
    expect(yes.hidden.has('decline_message')).toBe(true);
    const no = evaluateLogic(s, { attendance: 'decline' });
    expect(no.hidden.has('guest_count')).toBe(true);
    expect(no.hidden.has('decline_message')).toBe(false);
  });

  it('supports every operator', () => {
    const s = buildSchema({
      title: 't',
      pages: [{ id: 'p', elements: [el('number', 'n'), el('short_text', 'txt'), el('multiple_choice', 'mc'), el('short_text', 'target')] }],
      logic: [],
    });
    const check = (operator: FormSchema['logic'][0]['conditions'][0]['operator'], fieldId: string, value: string | number | undefined, answers: Record<string, unknown>) => {
      s.logic = [{ id: 'r', combinator: 'and', conditions: [{ fieldId, operator, value }], actions: [{ type: 'hide', target: 'target' }] }];
      return evaluateLogic(s, answers).hidden.has('target');
    };
    expect(check('equals', 'txt', 'Hello', { txt: ' hello ' })).toBe(true);
    expect(check('not_equals', 'txt', 'Hello', { txt: 'bye' })).toBe(true);
    expect(check('contains', 'txt', 'ell', { txt: 'Hello' })).toBe(true);
    expect(check('not_contains', 'txt', 'xyz', { txt: 'Hello' })).toBe(true);
    expect(check('greater_than', 'n', 5, { n: 6 })).toBe(true);
    expect(check('greater_than', 'n', 5, { n: 5 })).toBe(false);
    expect(check('less_than', 'n', 5, { n: 4 })).toBe(true);
    expect(check('less_than', 'n', 5, {})).toBe(false);
    expect(check('is_empty', 'txt', undefined, { txt: '  ' })).toBe(true);
    expect(check('is_not_empty', 'txt', undefined, { txt: 'x' })).toBe(true);
    expect(check('contains', 'mc', 'option_2', { mc: ['option_1', 'option_2'] })).toBe(true);
    expect(check('not_contains', 'mc', 'option_3', { mc: ['option_1'] })).toBe(true);
  });

  it('supports AND / OR combinators', () => {
    const s = buildSchema({ title: 't', pages: [{ id: 'p', elements: [el('number', 'a'), el('number', 'b'), el('short_text', 'x')] }] });
    s.logic = [{ id: 'r', combinator: 'and', conditions: [{ fieldId: 'a', operator: 'greater_than', value: 1 }, { fieldId: 'b', operator: 'greater_than', value: 1 }], actions: [{ type: 'require', target: 'x' }] }];
    expect(evaluateLogic(s, { a: 2, b: 0 }).required.get('x')).toBe(false);
    expect(evaluateLogic(s, { a: 2, b: 2 }).required.get('x')).toBe(true);
    s.logic[0]!.combinator = 'or';
    expect(evaluateLogic(s, { a: 2, b: 0 }).required.get('x')).toBe(true);
  });

  it('cascades: hiding a field also clears rules depending on it', () => {
    const s = buildSchema({ title: 't', pages: [{ id: 'p', elements: [el('yes_no', 'a'), el('yes_no', 'b'), el('short_text', 'c')] }] });
    s.logic = [
      { id: 'r1', combinator: 'and', conditions: [{ fieldId: 'a', operator: 'equals', value: 'yes' }], actions: [{ type: 'show', target: 'b' }] },
      { id: 'r2', combinator: 'and', conditions: [{ fieldId: 'b', operator: 'equals', value: 'yes' }], actions: [{ type: 'show', target: 'c' }] },
    ];
    expect(evaluateLogic(s, { a: 'yes', b: 'yes' }).hidden.has('c')).toBe(false);
    // b still has a stale "yes" but is hidden, so c must be hidden too
    expect(evaluateLogic(s, { a: 'no', b: 'yes' }).hidden.has('c')).toBe(true);
  });

  it('navigates with goto_page and skip_page, and computes the path', () => {
    const s = structuredClone(getTemplate('wedding-multi-event')!.schema);
    expect(evaluateLogic(s, { attendance: 'accept' }).path).toEqual([0, 1, 2, 3]);
    expect(evaluateLogic(s, { attendance: 'decline' }).path).toEqual([0, 3]);
    expect(nextPageIndex(s, { attendance: 'decline' }, 0)).toBe(3);
    expect(nextPageIndex(s, { attendance: 'decline' }, 3)).toBe(-1);
    s.logic.push({ id: 'skip', combinator: 'and', conditions: [{ fieldId: 'attendance', operator: 'equals', value: 'maybe' }], actions: [{ type: 'skip_page', target: 'page_travel' }] });
    expect(evaluateLogic(s, { attendance: 'maybe' }).path).toEqual([0, 1, 3]);
  });

  it('emits show_message actions', () => {
    const s = wedding();
    s.logic.push({ id: 'msg', combinator: 'and', conditions: [{ fieldId: 'attendance', operator: 'equals', value: 'decline' }], actions: [{ type: 'show_message', message: 'Sorry to miss you' }] });
    expect(evaluateLogic(s, { attendance: 'decline' }).messages).toEqual([{ ruleId: 'msg', message: 'Sorry to miss you' }]);
  });
});

describe('validation', () => {
  it('requires visible required fields only', () => {
    const s = wedding();
    const r = validateAnswers(s, { full_name: 'Ann', email: 'ann@example.com', attendance: 'decline' });
    expect(r.ok).toBe(true);
    const r2 = validateAnswers(s, { full_name: 'Ann', email: 'ann@example.com', attendance: 'accept' });
    expect(r2.ok).toBe(false);
    expect(r2.errors.guest_count).toBeDefined();
  });

  it('drops answers for hidden fields and unknown keys', () => {
    const s = wedding();
    const r = validateAnswers(s, { full_name: 'Ann', email: 'ANN@example.com', attendance: 'decline', guest_count: { adults: 3, children: 0 }, evil: '<script>' });
    expect(r.cleaned).toEqual({ full_name: 'Ann', email: 'ann@example.com', attendance: 'decline' });
  });

  it('validates email, phone, url, date, time, number and choices', () => {
    const s = buildSchema({
      title: 't', pages: [{ id: 'p', elements: [
        el('email', 'e'), el('phone', 'ph'), el('website', 'w'), el('date', 'd'), el('time', 'tm'),
        el('number', 'n', { config: { min: 1, max: 10 } }), el('single_choice', 'sc'), el('rating', 'r'), el('country', 'c'),
      ] }],
    });
    const bad = validateAnswers(s, { e: 'nope', ph: '12', w: 'not a url', d: '2026-13-45', tm: '25:00', n: 11, sc: 'option_9', r: 9, c: 'XX' });
    expect(Object.keys(bad.errors).sort()).toEqual(['c', 'd', 'e', 'n', 'ph', 'r', 'sc', 'tm', 'w'].sort());
    const good = validateAnswers(s, { e: 'a@b.co', ph: '+91 98765 43210', w: 'example.com', d: '2026-12-01', tm: '18:30', n: '5', sc: 'option_1', r: 4, c: 'in' });
    expect(good.ok).toBe(true);
    expect(good.cleaned.w).toBe('https://example.com/');
    expect(good.cleaned.n).toBe(5);
    expect(good.cleaned.c).toBe('IN');
  });

  it('validates guest counts against min/max with adults and children', () => {
    const s = wedding();
    const base = { full_name: 'A', email: 'a@b.co', attendance: 'accept', meal: 'vegan' };
    expect(validateAnswers(s, { ...base, guest_count: { adults: 3, children: 2 } }).errors.guest_count).toMatch(/At most 4/);
    expect(validateAnswers(s, { ...base, guest_count: { adults: 2, children: 1 } }).ok).toBe(true);
    expect(validateAnswers(s, { ...base, guest_count: { adults: 0, children: 0 } }).errors.guest_count).toMatch(/At least 1/);
  });

  it('validates only the requested pages for per-step validation', () => {
    const s = getTemplate('wedding-multi-event')!.schema;
    const r = validateAnswers(s, { full_name: 'A', email: 'a@b.co', phone: '+919876543210', attendance: 'accept' }, { pages: [0] });
    expect(r.ok).toBe(true);
    const r2 = validateAnswers(s, { full_name: 'A', email: 'a@b.co', phone: '+919876543210', attendance: 'accept' });
    expect(r2.errors.events).toBeDefined();
  });

  it('never accepts client-side payment status', () => {
    const s = buildSchema({ title: 't', pages: [{ id: 'p', elements: [el('payment', 'pay', { config: { amount: 999, currency: 'INR' } })] }] });
    const r = validateAnswers(s, { pay: { status: 'paid', amount: 1 } });
    expect(r.cleaned.pay).toEqual({ status: 'pending', amount: 999, currency: 'INR' });
  });

  it('rejects upload keys outside the uploads namespace', () => {
    const s = buildSchema({ title: 't', pages: [{ id: 'p', elements: [el('file_upload', 'f')] }] });
    expect(validateAnswers(s, { f: [{ key: '../secrets', name: 'x', size: 10, type: 'text/plain' }] }).ok).toBe(false);
    expect(validateAnswers(s, { f: [{ key: 'uploads/frm_1/abc/file.pdf', name: 'x.pdf', size: 10, type: 'application/pdf' }] }).ok).toBe(true);
  });

  it('reads hidden fields from query params and static defaults', () => {
    const s = buildSchema({ title: 't', pages: [{ id: 'p', elements: [el('hidden', 'utm'), el('hidden', 'fixed', { defaultValue: 'abc', config: { source: 'static' } })] }] });
    const r = validateAnswers(s, { fixed: 'tampered' }, { query: { ref: 'newsletter' } });
    expect(r.cleaned).toEqual({ utm: 'newsletter', fixed: 'abc' });
  });
});

describe('rsvp derivation', () => {
  it('derives status, party size and meal', () => {
    const s = wedding();
    const { cleaned } = validateAnswers(s, { full_name: 'Ann', email: 'a@b.co', attendance: 'accept', guest_count: { adults: 2, children: 1 }, meal: 'vegan' });
    const r = deriveRsvp(s, cleaned);
    expect(r).toMatchObject({ status: 'accepted', partySize: 3, adults: 2, children: 1, meal: 'vegan', email: 'a@b.co', name: 'Ann' });
    expect(deriveRsvp(s, { attendance: 'decline' }).partySize).toBe(0);
  });
  it('formats answers for display', () => {
    const s = wedding();
    const meal = s.pages[0]!.elements.find((e) => e.id === 'meal');
    expect(formatAnswer(meal, 'vegan')).toBe('Vegan');
    const att = s.pages[0]!.elements.find((e) => e.id === 'attendance');
    expect(formatAnswer(att, 'accept')).toBe('Joyfully accept');
  });
});

describe('themes', () => {
  it('has 10 presets and preserves overrides on top of presets', () => {
    expect(THEME_PRESETS).toHaveLength(10);
    const t = resolveTheme({ presetId: 'luxury', overrides: { colors: { primary: '#ff0000' } } });
    expect(t.colors.primary).toBe('#ff0000');
    expect(t.colors.background).toBe('#14120F');
    const switched = resolveTheme({ presetId: 'modern', overrides: { colors: { primary: '#ff0000' } } });
    expect(switched.colors.primary).toBe('#ff0000');
    expect(switched.typography.headingFont).toBe('space_grotesk');
  });
});

describe('migration', () => {
  it('migrates the legacy flat field schema from the product brief', () => {
    const legacy = {
      form: { title: 'Wedding RSVP' }, settings: { layout: 'standard', submitLabel: 'Submit RSVP', allowMultipleSubmissions: false },
      theme: { presetId: 'minimal' },
      fields: [
        { id: 'attendance', type: 'single_choice', label: 'Will you attend?', required: true, options: ['Accept', 'Decline'] },
        { id: 'guest_count', type: 'number', label: 'Number of guests', required: true, min: 1, max: 4 },
      ],
      logic: [],
    };
    const res = migrateSchema(legacy);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.schema.pages[0]!.elements.map((e) => e.id)).toEqual(['attendance', 'guest_count']);
      expect(res.schema.pages[0]!.elements[1]!.config.max).toBe(4);
    }
  });
  it('rejects future schema versions', () => {
    expect(migrateSchema({ schemaVersion: 99 }).ok).toBe(false);
  });
});

describe('utils', () => {
  it('slugifies and interpolates', () => {
    expect(slugify('Sarah & John’s Wedding!')).toBe('sarah-and-johns-wedding');
    expect(interpolate('Thanks {{ full_name }}!', { full_name: 'Ann' })).toBe('Thanks Ann!');
    expect(interpolate('Hi {{x}}', { x: { evil: 1 } })).toBe('Hi ');
  });
});
