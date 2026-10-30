import { create } from 'zustand';
import {
  createElement, FIELD_DEFINITIONS, type FieldType, type FormElement, type FormPage, type FormSchema, type LogicRule,
  type ThemeOverrides,
} from '@rsvp/core';

export interface FormMeta {
  id: string; name: string; slug: string; status: 'draft' | 'published' | 'closed'; kind: 'form' | 'rsvp';
  access: 'public' | 'password' | 'invite_only'; hasPassword: boolean; closes_at: string | null; late_policy: 'block' | 'allow' | 'flag';
  closed_message: string | null; published: { id: string; version: number; published_at: string } | null;
  events: { id: string; name: string; slug: string; is_primary: number }[]; hasUnpublishedChanges: boolean;
}

export type Selection = { kind: 'element'; id: string } | { kind: 'page'; id: string } | { kind: 'form' } | null;
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'failed' | 'conflict';

interface EditorState {
  meta: FormMeta | null;
  schema: FormSchema | null;
  revision: number;
  selection: Selection;
  past: FormSchema[];
  future: FormSchema[];
  lastCoalesce: { key: string; at: number } | null;
  saveState: SaveState;
  lastSavedAt: number | null;
  saveError: string | null;
  conflict: { revision: number; schema: FormSchema } | null;
  /** increments on every schema change; autosave compares against the saved counter */
  changeSeq: number;
  device: 'desktop' | 'mobile';
  collapsedSections: Record<string, boolean>;

  init: (meta: FormMeta, schema: FormSchema, revision: number) => void;
  setMeta: (patch: Partial<FormMeta>) => void;
  /** Apply a mutation to a cloned schema. `coalesce` merges rapid edits (typing) into one undo step. */
  update: (fn: (s: FormSchema) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setDevice: (d: 'desktop' | 'mobile') => void;
  toggleSection: (id: string) => void;

  addElement: (type: FieldType, target?: { pageId: string; index: number }) => string;
  moveElement: (id: string, toPageId: string, toIndex: number) => void;
  duplicateElement: (id: string) => void;
  deleteElement: (id: string) => void;
  updateElement: (id: string, fn: (el: FormElement) => void, coalesce?: string) => void;
  addPage: () => void;
  deletePage: (id: string) => void;
  movePage: (id: string, dir: -1 | 1) => void;
  setThemePreset: (presetId: string, keepOverrides: boolean) => void;
  setThemeOverride: <K extends keyof ThemeOverrides>(group: K, patch: NonNullable<ThemeOverrides[K]>) => void;
  setLogic: (rules: LogicRule[]) => void;
  markSaving: () => void;
  markSaved: (revision: number, seqAtSave: number) => void;
  markFailed: (msg: string) => void;
  markConflict: (c: { revision: number; schema: FormSchema }) => void;
  resolveConflict: (useServer: boolean) => void;
  savedSeq: number;
}

const HISTORY_LIMIT = 100;

export function locate(schema: FormSchema, id: string): { page: FormPage; pageIndex: number; index: number } | null {
  for (let pi = 0; pi < schema.pages.length; pi++) {
    const page = schema.pages[pi]!;
    const index = page.elements.findIndex((e) => e.id === id);
    if (index >= 0) return { page, pageIndex: pi, index };
  }
  return null;
}

const allIds = (s: FormSchema) => [...s.pages.map((p) => p.id), ...s.pages.flatMap((p) => p.elements.map((e) => e.id))];

/** Remove references to a deleted element/page from logic rules so the schema stays valid. */
function pruneLogic(s: FormSchema) {
  const ids = new Set(s.pages.flatMap((p) => p.elements.map((e) => e.id)));
  const pages = new Set(s.pages.map((p) => p.id));
  s.logic = s.logic
    .map((r) => ({
      ...r,
      conditions: r.conditions.filter((c) => ids.has(c.fieldId)),
      actions: r.actions.filter((a) => (a.type === 'goto_page' || a.type === 'skip_page' ? a.target && pages.has(a.target) : a.type === 'show_message' ? true : a.target && ids.has(a.target))),
    }))
    .filter((r) => r.conditions.length && r.actions.length);
}

export const useEditor = create<EditorState>((set, get) => ({
  meta: null, schema: null, revision: 0, selection: null, past: [], future: [], lastCoalesce: null,
  saveState: 'saved', lastSavedAt: null, saveError: null, conflict: null, changeSeq: 0, savedSeq: 0, device: 'desktop', collapsedSections: {},

  init: (meta, schema, revision) => set({ meta, schema, revision, past: [], future: [], selection: null, saveState: 'saved', changeSeq: 0, savedSeq: 0, conflict: null, lastSavedAt: Date.now() }),
  setMeta: (patch) => set((s) => ({ meta: s.meta ? { ...s.meta, ...patch } : s.meta, ...(patch.hasUnpublishedChanges === false ? { changeSeq: 0, savedSeq: 0 } : {}) })),

  update: (fn, coalesce) => {
    const { schema, past, lastCoalesce, changeSeq } = get();
    if (!schema) return;
    const next = structuredClone(schema);
    fn(next);
    const now = Date.now();
    const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < 1000;
    set({
      schema: next,
      past: merge ? past : [...past.slice(-HISTORY_LIMIT + 1), schema],
      future: [],
      lastCoalesce: coalesce ? { key: coalesce, at: now } : null,
      saveState: get().saveState === 'conflict' ? 'conflict' : 'unsaved',
      changeSeq: changeSeq + 1,
    });
  },
  undo: () => {
    const { past, future, schema, changeSeq, selection } = get();
    const prev = past[past.length - 1];
    if (!prev || !schema) return;
    const sel = selection?.kind === 'element' && !locate(prev, selection.id) ? null : selection;
    set({ schema: prev, past: past.slice(0, -1), future: [schema, ...future], lastCoalesce: null, saveState: 'unsaved', changeSeq: changeSeq + 1, selection: sel });
  },
  redo: () => {
    const { past, future, schema, changeSeq } = get();
    const next = future[0];
    if (!next || !schema) return;
    set({ schema: next, past: [...past, schema], future: future.slice(1), lastCoalesce: null, saveState: 'unsaved', changeSeq: changeSeq + 1 });
  },
  select: (selection) => set({ selection }),
  setDevice: (device) => set({ device }),
  toggleSection: (id) => set((s) => ({ collapsedSections: { ...s.collapsedSections, [id]: !s.collapsedSections[id] } })),

  addElement: (type, target) => {
    const { schema, selection } = get();
    if (!schema) return '';
    const el = createElement(type, allIds(schema));
    if (FIELD_DEFINITIONS[type].category === 'rsvp' && type === 'attendance') el.required = true;
    get().update((s) => {
      let pageId = target?.pageId;
      let index = target?.index;
      if (!pageId) {
        // Insert after the selected element, otherwise at the end of the selected/last page.
        const loc = selection?.kind === 'element' ? locate(s, selection.id) : null;
        if (loc) { pageId = loc.page.id; index = loc.index + 1; }
        else { const p = selection?.kind === 'page' ? s.pages.find((x) => x.id === selection.id) : s.pages[s.pages.length - 1]; pageId = p!.id; index = p!.elements.length; }
      }
      const page = s.pages.find((p) => p.id === pageId)!;
      page.elements.splice(Math.min(index ?? page.elements.length, page.elements.length), 0, el);
    });
    set({ selection: { kind: 'element', id: el.id } });
    return el.id;
  },
  moveElement: (id, toPageId, toIndex) => get().update((s) => {
    const loc = locate(s, id);
    if (!loc) return;
    const [el] = loc.page.elements.splice(loc.index, 1);
    const dest = s.pages.find((p) => p.id === toPageId);
    if (!dest || !el) return;
    dest.elements.splice(Math.max(0, Math.min(toIndex, dest.elements.length)), 0, el);
  }),
  duplicateElement: (id) => {
    const { schema } = get();
    if (!schema) return;
    const loc = locate(schema, id);
    if (!loc) return;
    const copy = structuredClone(loc.page.elements[loc.index]!);
    let n = 2;
    const ids = new Set(allIds(schema));
    const base = copy.id.replace(/_copy(_\d+)?$/, '');
    while (ids.has(`${base}_copy${n === 2 ? '' : `_${n}`}`)) n++;
    copy.id = `${base}_copy${n === 2 ? '' : `_${n}`}`.slice(0, 64);
    get().update((s) => { const l = locate(s, id)!; l.page.elements.splice(l.index + 1, 0, copy); });
    set({ selection: { kind: 'element', id: copy.id } });
  },
  deleteElement: (id) => {
    const { schema } = get();
    if (!schema) return;
    const loc = locate(schema, id);
    get().update((s) => { const l = locate(s, id); if (l) l.page.elements.splice(l.index, 1); pruneLogic(s); });
    const sibling = loc ? loc.page.elements[loc.index + 1] ?? loc.page.elements[loc.index - 1] : undefined;
    set({ selection: sibling && sibling.id !== id ? { kind: 'element', id: sibling.id } : null });
  },
  updateElement: (id, fn, coalesce) => get().update((s) => { const l = locate(s, id); if (l) fn(l.page.elements[l.index]!); }, coalesce ?? `el:${id}`),
  addPage: () => {
    const { schema } = get();
    if (!schema) return;
    const ids = new Set(schema.pages.map((p) => p.id));
    let n = schema.pages.length + 1;
    while (ids.has(`page_${n}`)) n++;
    get().update((s) => { s.pages.push({ id: `page_${n}`, title: `Page ${s.pages.length + 1}`, elements: [] }); if (s.pages.length > 1 && s.settings.layout === 'standard') s.settings.layout = 'multistep'; });
    set({ selection: { kind: 'page', id: `page_${n}` } });
  },
  deletePage: (id) => get().update((s) => {
    if (s.pages.length <= 1) return;
    const i = s.pages.findIndex((p) => p.id === id);
    const [removed] = s.pages.splice(i, 1);
    // Keep the page's elements by moving them to the previous page rather than silently deleting content.
    if (removed?.elements.length) s.pages[Math.max(0, i - 1)]!.elements.push(...removed.elements);
    pruneLogic(s);
  }),
  movePage: (id, dir) => get().update((s) => {
    const i = s.pages.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.pages.length) return;
    [s.pages[i], s.pages[j]] = [s.pages[j]!, s.pages[i]!];
  }),
  setThemePreset: (presetId, keepOverrides) => get().update((s) => { s.theme.presetId = presetId; if (!keepOverrides) s.theme.overrides = {}; }),
  setThemeOverride: (group, patch) => get().update((s) => {
    const cur = (s.theme.overrides[group] ?? {}) as Record<string, unknown>;
    const merged = { ...cur, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    (s.theme.overrides as Record<string, unknown>)[group] = merged;
  }, `theme:${group}:${Object.keys(patch).join(',')}`),
  setLogic: (rules) => get().update((s) => { s.logic = rules; }),

  markSaving: () => set({ saveState: 'saving', saveError: null }),
  markSaved: (revision, seqAtSave) => set((s) => ({ revision, savedSeq: seqAtSave, lastSavedAt: Date.now(), saveState: s.changeSeq === seqAtSave ? 'saved' : 'unsaved', saveError: null })),
  markFailed: (msg) => set({ saveState: 'failed', saveError: msg }),
  markConflict: (conflict) => set({ saveState: 'conflict', conflict }),
  resolveConflict: (useServer) => {
    const { conflict, changeSeq } = get();
    if (!conflict) return;
    if (useServer) set({ schema: conflict.schema, revision: conflict.revision, conflict: null, saveState: 'saved', past: [], future: [], savedSeq: changeSeq + 1, changeSeq: changeSeq + 1, selection: null });
    else set({ revision: conflict.revision, conflict: null, saveState: 'unsaved', changeSeq: changeSeq + 1 });
  },
}));
