import { FIELD_DEFINITIONS } from './fields';
import type { Condition, FormElement, FormSchema, LogicRule } from './schema';

export type Answers = Record<string, unknown>;

export interface LogicState {
  /** element ids hidden by logic (or because their page is not on the path) */
  hidden: Set<string>;
  /** effective required flag for every input element */
  required: Map<string, boolean>;
  /** page ids skipped by skip_page actions */
  skippedPages: Set<string>;
  /** messages produced by show_message actions */
  messages: { ruleId: string; message: string }[];
  /** ordered page indexes the respondent will traverse given current answers */
  path: number[];
}

/** Convert structured answer values to something comparable in conditions. */
export function comparableValue(el: FormElement | undefined, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (!el) return value;
  switch (FIELD_DEFINITIONS[el.type].valueKind) {
    case 'guest_count': {
      const v = value as { adults?: number; children?: number };
      return (Number(v.adults) || 0) + (Number(v.children) || 0);
    }
    case 'plus_one': {
      const v = value as { bringing?: boolean };
      return v.bringing === undefined ? undefined : v.bringing ? 'yes' : 'no';
    }
    case 'dietary':
      return (value as { restrictions?: string[] }).restrictions ?? [];
    case 'address': {
      const v = value as Record<string, string | undefined>;
      return Object.values(v).filter(Boolean).join(', ');
    }
    case 'files':
      return Array.isArray(value) ? value : [];
    case 'payment':
      return (value as { status?: string }).status;
    default:
      return value;
  }
}

export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  return false;
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

export function evaluateCondition(c: Condition, raw: unknown): boolean {
  const value = raw;
  switch (c.operator) {
    case 'is_empty':
      return isEmptyValue(value);
    case 'is_not_empty':
      return !isEmptyValue(value);
    case 'equals':
      if (isEmptyValue(value)) return false;
      if (Array.isArray(value)) return value.length === 1 && norm(String(value[0])) === norm(String(c.value));
      if (typeof value === 'number') return value === Number(c.value);
      if (typeof value === 'boolean') return value === (c.value === true || c.value === 'true' || c.value === 'yes');
      return norm(String(value)) === norm(String(c.value ?? ''));
    case 'not_equals':
      return !evaluateCondition({ ...c, operator: 'equals' }, value);
    case 'contains':
      if (isEmptyValue(value)) return false;
      if (Array.isArray(value)) return value.some((v) => norm(String(v)) === norm(String(c.value)));
      return String(value).toLowerCase().includes(String(c.value ?? '').toLowerCase());
    case 'not_contains':
      return !evaluateCondition({ ...c, operator: 'contains' }, value);
    case 'greater_than': {
      const n = typeof value === 'number' ? value : Number(value);
      return !isEmptyValue(value) && !Number.isNaN(n) && n > Number(c.value);
    }
    case 'less_than': {
      const n = typeof value === 'number' ? value : Number(value);
      return !isEmptyValue(value) && !Number.isNaN(n) && n < Number(c.value);
    }
  }
}

export function ruleMatches(rule: LogicRule, schema: FormSchema, answers: Answers, hidden: Set<string>, index: Map<string, FormElement>): boolean {
  const results = rule.conditions.map((c) => {
    const val = hidden.has(c.fieldId) ? undefined : comparableValue(index.get(c.fieldId), answers[c.fieldId]);
    return evaluateCondition(c, val);
  });
  return rule.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function indexElements(schema: FormSchema) {
  const index = new Map<string, FormElement>();
  const pageOf = new Map<string, number>();
  schema.pages.forEach((p, pi) => p.elements.forEach((e) => { index.set(e.id, e); pageOf.set(e.id, pi); }));
  return { index, pageOf };
}

/**
 * Evaluate all rules against the answers. Visibility is resolved to a fixed point so that a field
 * hidden by one rule cannot keep another field visible through a chained condition.
 */
export function evaluateLogic(schema: FormSchema, answers: Answers): LogicState {
  const { index, pageOf } = indexElements(schema);
  const showTargets = new Set<string>();
  for (const r of schema.logic) for (const a of r.actions) if (a.type === 'show' && a.target) showTargets.add(a.target);

  let hidden = new Set<string>();
  let matched: LogicRule[] = [];
  for (let iter = 0; iter < 8; iter++) {
    matched = schema.logic.filter((r) => ruleMatches(r, schema, answers, hidden, index));
    const shown = new Set<string>();
    const hiddenNext = new Set<string>();
    for (const r of matched) for (const a of r.actions) {
      if (a.type === 'show' && a.target) shown.add(a.target);
      if (a.type === 'hide' && a.target) hiddenNext.add(a.target);
    }
    for (const t of showTargets) if (!shown.has(t)) hiddenNext.add(t);
    const same = hiddenNext.size === hidden.size && [...hiddenNext].every((h) => hidden.has(h));
    hidden = hiddenNext;
    if (same) break;
  }

  const required = new Map<string, boolean>();
  for (const el of index.values()) if (FIELD_DEFINITIONS[el.type].isInput) required.set(el.id, Boolean(el.required));
  const skippedPages = new Set<string>();
  const messages: LogicState['messages'] = [];
  for (const r of matched) for (const a of r.actions) {
    if (a.type === 'require' && a.target) required.set(a.target, true);
    if (a.type === 'unrequire' && a.target) required.set(a.target, false);
    if (a.type === 'skip_page' && a.target) skippedPages.add(a.target);
    if (a.type === 'show_message' && a.message) messages.push({ ruleId: r.id, message: a.message });
  }

  const partial: LogicState = { hidden, required, skippedPages, messages, path: [] };
  partial.path = computePath(schema, answers, partial, matched);

  // Elements on pages outside the path are treated as hidden (not validated, not stored).
  const onPath = new Set(partial.path);
  for (const [id, pi] of pageOf) if (!onPath.has(pi)) hidden.add(id);
  return partial;
}

function pageHasVisibleContent(schema: FormSchema, pi: number, hidden: Set<string>): boolean {
  const page = schema.pages[pi];
  return Boolean(page && page.elements.some((e) => !hidden.has(e.id) && e.type !== 'hidden'));
}

function nextIndex(schema: FormSchema, from: number, state: Pick<LogicState, 'hidden' | 'skippedPages'>, matched: LogicRule[]): number {
  const fromId = schema.pages[from]?.id;
  // explicit navigation rule
  for (const r of matched) for (const a of r.actions) {
    if (a.type !== 'goto_page' || !a.target) continue;
    const source = a.fromPage ?? lastConditionPage(schema, r);
    if (source !== fromId) continue;
    const target = schema.pages.findIndex((p) => p.id === a.target);
    if (target > from) return skipForward(schema, target, state);
  }
  return skipForward(schema, from + 1, state);
}

function skipForward(schema: FormSchema, start: number, state: Pick<LogicState, 'hidden' | 'skippedPages'>): number {
  for (let i = start; i < schema.pages.length; i++) {
    const p = schema.pages[i]!;
    if (state.skippedPages.has(p.id)) continue;
    if (!pageHasVisibleContent(schema, i, state.hidden)) continue;
    return i;
  }
  return -1;
}

function lastConditionPage(schema: FormSchema, rule: LogicRule): string | undefined {
  let last = -1;
  schema.pages.forEach((p, pi) => {
    if (p.elements.some((e) => rule.conditions.some((c) => c.fieldId === e.id))) last = pi;
  });
  return last >= 0 ? schema.pages[last]!.id : undefined;
}

function computePath(schema: FormSchema, _answers: Answers, state: Pick<LogicState, 'hidden' | 'skippedPages'>, matched: LogicRule[]): number[] {
  const path: number[] = [];
  let i = skipForward(schema, 0, state);
  if (i === -1 && schema.pages.length) i = 0;
  const guard = new Set<number>();
  while (i !== -1 && !guard.has(i)) {
    guard.add(i);
    path.push(i);
    i = nextIndex(schema, i, state, matched);
  }
  return path;
}

/** Next page index after `current` for the renderer (-1 means submit). */
export function nextPageIndex(schema: FormSchema, answers: Answers, current: number): number {
  const state = evaluateLogic(schema, answers);
  const pos = state.path.indexOf(current);
  if (pos === -1) {
    // current page no longer on path (answers changed) – continue to first path page after it
    const after = state.path.find((p) => p > current);
    return after ?? -1;
  }
  return state.path[pos + 1] ?? -1;
}

export function isVisible(state: LogicState, id: string): boolean {
  return !state.hidden.has(id);
}

export function isRequired(state: LogicState, id: string): boolean {
  return state.required.get(id) ?? false;
}
