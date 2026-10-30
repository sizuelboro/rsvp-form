import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  AlertTriangle, ArrowLeft, Check, CloudOff, Eye, GitBranch, History, Keyboard, Loader2, Monitor, MoreHorizontal, Palette, Plus,
  Redo2, Settings2, Share2, SlidersHorizontal, Smartphone, Undo2, Inbox, X,
} from 'lucide-react';
import { FIELD_DEFINITIONS, type FieldType, type FormSchema } from '@rsvp/core';
import { get, patch, post } from '../../lib/api';
import { useWpath, useCan } from '../../stores/session';
import { toast } from '../../stores/toast';
import { useHotkey } from '../../lib/hooks';
import { timeAgo, fmtDateTime } from '../../lib/format';
import { Badge, Button, ConfirmDialog, Dialog, Kbd, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Spinner, Tabs, Tooltip, cn } from '../../components/ui';
import { useEditor, locate, type FormMeta } from './store';
import { useAutosave } from './autosave';
import { ElementsPanel } from './ElementsPanel';
import { Canvas } from './Canvas';
import { ElementInspector, PageInspector } from './Inspector';
import { ThemePanel } from './ThemePanel';
import { FormSettingsPanel } from './FormSettingsPanel';
import { LogicBuilder } from './LogicBuilder';
import { Preview } from './Preview';
import { AccessDialog, PublishDialog } from './PublishDialog';
import { FIELD_ICONS } from './icons';

function SaveIndicator({ onRetry }: { onRetry: () => void }) {
  const state = useEditor((s) => s.saveState);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const error = useEditor((s) => s.saveError);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const map = {
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'Saving…', cls: 'text-muted' },
    saved: { icon: <Check className="size-3.5" />, text: lastSavedAt ? `Saved ${timeAgo(new Date(lastSavedAt).toISOString())}` : 'Saved', cls: 'text-muted' },
    unsaved: { icon: <span className="size-1.5 rounded-full bg-warning" />, text: 'Unsaved changes', cls: 'text-muted' },
    failed: { icon: <CloudOff className="size-3.5" />, text: 'Save failed', cls: 'text-danger' },
    conflict: { icon: <AlertTriangle className="size-3.5" />, text: 'Conflict', cls: 'text-warning' },
  }[state];
  return (
    <Tooltip content={state === 'failed' ? `${error ?? 'Network error'} — retrying automatically. Click to retry now.` : state === 'saved' ? 'All changes saved to draft' : map.text}>
      <button onClick={state === 'failed' ? onRetry : undefined} className={cn('hidden sm:flex items-center gap-1.5 text-[12px] whitespace-nowrap px-2 h-7 rounded-md', map.cls, state === 'failed' && 'hover:bg-danger-50 cursor-pointer')} aria-live="polite">
        {map.icon}{map.text}
      </button>
    </Tooltip>
  );
}

function ConflictBanner() {
  const conflict = useEditor((s) => s.conflict);
  const resolve = useEditor((s) => s.resolveConflict);
  if (!conflict) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-warning-50 border-b border-warning/20 text-[13px]">
      <AlertTriangle className="size-4 text-warning" />
      <span className="flex-1 min-w-[200px]"><b>This form was changed in another tab or by a teammate.</b> Choose which version to keep.</span>
      <Button size="sm" onClick={() => resolve(true)}>Load their version</Button>
      <Button size="sm" variant="primary" onClick={() => resolve(false)}>Keep my changes</Button>
    </div>
  );
}

function VersionsDialog({ open, onOpenChange, path, onRestored }: { open: boolean; onOpenChange: (v: boolean) => void; path: string; onRestored: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [restoring, setRestoring] = useState<any>(null);
  useEffect(() => { if (open) get(`${path}/versions`).then((r) => setItems(r.items)).catch(toast.error); }, [open, path]);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title="Version history" description="Every publish is saved as an immutable version. Restoring copies it into your draft.">
        {!items ? <Spinner /> : items.length === 0 ? <p className="text-[13px] text-muted py-4">No published versions yet.</p> : (
          <ul className="divide-y divide-line -mx-2">
            {items.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-2 py-3">
                <Badge tone="brand">v{v.version}</Badge>
                <div className="flex-1 text-[13px]"><p>{fmtDateTime(v.published_at)}</p><p className="text-[12px] text-muted">{v.published_by_name ?? 'Unknown'} · {v.responses} responses</p></div>
                <Button size="sm" onClick={() => setRestoring(v)}>Restore</Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <ConfirmDialog open={Boolean(restoring)} onOpenChange={(v) => !v && setRestoring(null)} title={`Restore version ${restoring?.version}?`} confirmLabel="Restore to draft"
        description="Your current draft will be replaced. The live form doesn’t change until you publish."
        onConfirm={async () => { await post(`${path}/versions/${restoring.id}/restore`); toast.success(`Version ${restoring.version} restored to draft`); onOpenChange(false); onRestored(); }} />
    </>
  );
}

const SHORTCUTS: [string, string][] = [['⌘ Z', 'Undo'], ['⌘ ⇧ Z', 'Redo'], ['⌘ D', 'Duplicate field'], ['Delete', 'Delete field'], ['Alt ↑ / ↓', 'Move field'], ['↑ / ↓', 'Select previous / next'], ['⌘ S', 'Save now'], ['⌘ P', 'Preview'], ['Esc', 'Deselect'], ['?', 'Show shortcuts']];

type RightTab = 'design' | 'settings';

export default function Editor() {
  const { formId } = useParams();
  const wp = useWpath();
  const path = wp(`/forms/${formId}`)!;
  const navigate = useNavigate();
  const can = useCan();
  const init = useEditor((s) => s.init);
  const schema = useEditor((s) => s.schema);
  const meta = useEditor((s) => s.meta);
  const selection = useEditor((s) => s.selection);
  const device = useEditor((s) => s.device);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const dirtySincePublish = useEditor((s) => s.changeSeq > 0 || Boolean(s.meta?.hasUnpublishedChanges));
  const { undo, redo, select, setDevice, addElement, moveElement, duplicateElement, deleteElement, setMeta } = useEditor.getState();
  const { saveNow } = useAutosave(can.write ? path : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('design');
  const [logicOpen, setLogicOpen] = useState<{ open: boolean; seed?: string }>({ open: false });
  const [preview, setPreview] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'elements' | 'inspector' | null>(null);
  const [dragType, setDragType] = useState<FieldType | null>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      const f = await get<FormMeta & { schema: FormSchema; draft_revision: number }>(path);
      init(f, f.schema, f.draft_revision);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load the form'); }
  }, [path, init]);
  useEffect(() => { void load(); return () => useEditor.setState({ schema: null, meta: null }); }, [load]);

  // ── keyboard shortcuts ──
  const typing = () => { const a = document.activeElement as HTMLElement | null; return Boolean(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)); };
  useHotkey('mod+z', (e) => { if (typing()) return; e.preventDefault(); undo(); });
  useHotkey('mod+shift+z', (e) => { if (typing()) return; e.preventDefault(); redo(); });
  useHotkey('mod+y', (e) => { if (typing()) return; e.preventDefault(); redo(); });
  useHotkey('mod+s', (e) => { e.preventDefault(); void saveNow(); });
  useHotkey('mod+p', (e) => { e.preventDefault(); setPreview(true); });
  useHotkey('mod+d', (e) => { const s = useEditor.getState().selection; if (s?.kind === 'element' && !typing()) { e.preventDefault(); duplicateElement(s.id); } });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing() || preview || document.querySelector('[role="dialog"]')) return;
      const st = useEditor.getState();
      const sel = st.selection;
      if (e.key === 'Escape') select(null);
      if (e.key === '?') setShortcutsOpen(true);
      if (sel?.kind !== 'element' || !st.schema) return;
      const loc = locate(st.schema, sel.id);
      if (!loc) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteElement(sel.id); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (e.altKey) moveElement(sel.id, loc.page.id, Math.max(0, loc.index + dir));
        else { const flat = st.schema.pages.flatMap((p) => p.elements); const i = flat.findIndex((x) => x.id === sel.id); const next = flat[i + dir]; if (next) select({ kind: 'element', id: next.id }); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, select, deleteElement, moveElement]);

  // On small screens, open the inspector sheet when something is selected.
  useEffect(() => { if (selection?.kind === 'element' && window.innerWidth < 1024) setMobilePanel((p) => (p === 'elements' ? null : p)); }, [selection]);

  // ── drag and drop ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragStart = (e: DragStartEvent) => { if (e.active.data.current?.from === 'palette') setDragType(e.active.data.current.type as FieldType); };
  const onDragEnd = (e: DragEndEvent) => {
    setDragType(null);
    const { active, over } = e;
    const st = useEditor.getState();
    if (!over || !st.schema) return;
    const overId = String(over.id);
    let pageId: string, index: number;
    if (overId.startsWith('page:')) {
      pageId = overId.slice(5);
      index = st.schema.pages.find((p) => p.id === pageId)?.elements.length ?? 0;
    } else {
      const loc = locate(st.schema, overId);
      if (!loc) return;
      pageId = loc.page.id;
      index = loc.index;
    }
    if (active.data.current?.from === 'palette') { addElement(active.data.current.type as FieldType, { pageId, index }); return; }
    if (active.id === over.id) return;
    moveElement(String(active.id), pageId, index);
  };

  const renameForm = (name: string) => {
    setMeta({ name });
    clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => { if (name.trim()) patch(path, { name: name.trim() }).catch(toast.error); }, 700);
  };

  if (loadError) return <div className="h-full grid place-items-center text-center p-6"><div><p className="font-medium">{loadError}</p><Link to="/forms" className="text-brand-600 text-[13px] mt-2 inline-block">Back to forms</Link></div></div>;
  if (!schema || !meta) return <div className="h-full grid place-items-center"><Spinner className="size-5" /></div>;

  const selectedEl = selection?.kind === 'element' ? locate(schema, selection.id)?.page.elements[locate(schema, selection.id)!.index] : undefined;
  const inspector = selectedEl ? <ElementInspector el={selectedEl} onOpenLogic={(seed) => setLogicOpen({ open: true, seed })} />
    : selection?.kind === 'page' ? <PageInspector pageId={selection.id} />
    : (
      <div>
        <div className="px-3 pt-2 border-b border-line"><Tabs value={rightTab} onChange={setRightTab} items={[{ value: 'design', label: <span className="flex items-center gap-1.5"><Palette className="size-3.5" />Design</span> }, { value: 'settings', label: <span className="flex items-center gap-1.5"><SlidersHorizontal className="size-3.5" />Settings</span> }]} className="border-0" /></div>
        {rightTab === 'design' ? <ThemePanel /> : <FormSettingsPanel />}
      </div>
    );
  const DragIcon = dragType ? FIELD_ICONS[FIELD_DEFINITIONS[dragType].icon] ?? FIELD_ICONS.Type! : null;

  return (
    <div className="h-full flex flex-col bg-[#F3F2EE]">
      {/* ─── Toolbar ─── */}
      <header className="h-14 shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 bg-surface border-b border-line">
        <Tooltip content="Back to forms"><Button variant="ghost" size="icon" onClick={() => navigate('/forms')} aria-label="Back to forms"><ArrowLeft className="size-4" /></Button></Tooltip>
        <input value={meta.name} onChange={(e) => renameForm(e.target.value)} aria-label="Form name" disabled={!can.write}
          className="min-w-0 w-[120px] sm:w-[220px] h-8 px-2 rounded-md text-[14px] font-semibold bg-transparent hover:bg-hover focus:bg-hover outline-none truncate" />
        <span className="hidden md:block">{meta.status === 'published' ? <Badge tone={dirtySincePublish ? 'warning' : 'success'} dot>{dirtySincePublish ? 'Unpublished changes' : 'Live'}</Badge> : meta.status === 'closed' ? <Badge tone="warning" dot>Closed</Badge> : <Badge dot>Draft</Badge>}</span>
        <SaveIndicator onRetry={() => void saveNow()} />
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-0.5">
          <Tooltip content="Undo (⌘Z)"><Button variant="ghost" size="icon" disabled={!past} onClick={undo} aria-label="Undo"><Undo2 className="size-4" /></Button></Tooltip>
          <Tooltip content="Redo (⌘⇧Z)"><Button variant="ghost" size="icon" disabled={!future} onClick={redo} aria-label="Redo"><Redo2 className="size-4" /></Button></Tooltip>
        </div>
        <div className="hidden lg:block"><Segmented size="sm" value={device} onChange={setDevice} items={[{ value: 'desktop', label: <Monitor />, title: 'Desktop canvas' }, { value: 'mobile', label: <Smartphone />, title: 'Mobile canvas' }]} /></div>
        <div className="hidden md:flex items-center gap-0.5">
          <Tooltip content="Theme"><Button variant="ghost" size="icon" onClick={() => { select({ kind: 'form' }); setRightTab('design'); if (window.innerWidth < 1024) setMobilePanel('inspector'); }} aria-label="Theme settings"><Palette className="size-4" /></Button></Tooltip>
          <Tooltip content="Logic"><Button variant="ghost" size="icon" onClick={() => setLogicOpen({ open: true })} aria-label="Logic builder"><span className="relative"><GitBranch className="size-4" />{schema.logic.length > 0 && <span className="absolute -top-1.5 -right-2 min-w-3.5 h-3.5 px-0.5 rounded-full bg-brand-500 text-white text-[9px] grid place-items-center">{schema.logic.length}</span>}</span></Button></Tooltip>
        </div>
        <Button variant="secondary" size="sm" icon={<Eye className="size-3.5" />} onClick={() => setPreview(true)} className="hidden sm:inline-flex">Preview</Button>
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal className="size-4" /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Eye />} onSelect={() => setPreview(true)} shortcut="⌘P">Preview</MenuItem>
            <MenuItem icon={<GitBranch />} onSelect={() => setLogicOpen({ open: true })}>Logic</MenuItem>
            <MenuItem icon={<Settings2 />} onSelect={() => setAccessOpen(true)}>Access & deadline</MenuItem>
            <MenuItem icon={<History />} onSelect={() => setVersionsOpen(true)}>Version history</MenuItem>
            <MenuItem icon={<Inbox />} onSelect={() => navigate(`/responses?formId=${meta.id}`)}>Responses</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Undo2 />} disabled={!past} onSelect={undo}>Undo</MenuItem>
            <MenuItem icon={<Redo2 />} disabled={!future} onSelect={redo}>Redo</MenuItem>
            <MenuItem icon={<Keyboard />} onSelect={() => setShortcutsOpen(true)} shortcut="?">Keyboard shortcuts</MenuItem>
          </MenuContent>
        </Menu>
        <Tooltip content="Access & deadline"><Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={() => setAccessOpen(true)} aria-label="Access settings"><Settings2 className="size-4" /></Button></Tooltip>
        {can.write && <Button variant="primary" size="sm" icon={<Share2 className="size-3.5" />} onClick={() => setPublishOpen(true)}>Publish</Button>}
      </header>
      <ConflictBanner />
      {!can.write && <div className="px-4 py-2 text-[12.5px] bg-info-50 border-b border-line text-ink-2">You have view-only access to this form.</div>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragType(null)}>
        <div className="flex-1 flex min-h-0 relative">
          {/* Left: elements */}
          <aside className={cn('w-[248px] shrink-0 bg-surface border-r border-line', 'hidden lg:block', mobilePanel === 'elements' && '!block absolute inset-y-0 left-0 z-30 shadow-lg animate-slide-in-right')} aria-label="Elements">
            {mobilePanel === 'elements' && <button className="lg:hidden absolute right-2 top-2.5 z-10 p-1 text-muted" onClick={() => setMobilePanel(null)} aria-label="Close elements"><X className="size-4" /></button>}
            <ElementsPanel />
          </aside>
          {/* Center: canvas */}
          <main className="flex-1 min-w-0 overflow-y-auto" aria-label="Canvas">
            <Canvas />
          </main>
          {/* Right: inspector */}
          <aside className={cn('w-[300px] shrink-0 bg-surface border-l border-line overflow-y-auto', 'hidden lg:block', mobilePanel === 'inspector' && '!block absolute inset-y-0 right-0 z-30 w-[min(340px,100vw)] shadow-lg animate-slide-in-right')} aria-label="Properties">
            {mobilePanel === 'inspector' && <button className="lg:hidden absolute right-2 top-2.5 z-10 p-1 text-muted bg-surface rounded" onClick={() => setMobilePanel(null)} aria-label="Close properties"><X className="size-4" /></button>}
            {inspector}
          </aside>
          {mobilePanel && <div className="lg:hidden absolute inset-0 z-20 bg-ink/15" onClick={() => setMobilePanel(null)} />}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragType && DragIcon && <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-surface border border-brand-500 shadow-lg text-[13px] font-medium"><DragIcon className="size-4 text-brand-500" />{FIELD_DEFINITIONS[dragType].name}</div>}
        </DragOverlay>
      </DndContext>

      {/* Mobile/tablet bottom bar */}
      <div className="lg:hidden h-14 shrink-0 flex items-center justify-around border-t border-line bg-surface">
        <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setMobilePanel(mobilePanel === 'elements' ? null : 'elements')}>Add</Button>
        <Button variant="ghost" size="sm" icon={<SlidersHorizontal className="size-4" />} onClick={() => setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector')}>{selectedEl ? 'Edit field' : 'Design'}</Button>
        <Button variant="ghost" size="sm" icon={<Undo2 className="size-4" />} disabled={!past} onClick={undo}>Undo</Button>
        <Button variant="ghost" size="sm" icon={<Eye className="size-4" />} onClick={() => setPreview(true)}>Preview</Button>
      </div>

      {preview && <Preview onClose={() => setPreview(false)} />}
      <LogicBuilder open={logicOpen.open} seedFieldId={logicOpen.seed} onOpenChange={(v) => setLogicOpen({ open: v })} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} path={path} flush={saveNow} />
      <AccessDialog open={accessOpen} onOpenChange={setAccessOpen} path={path} />
      <VersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} path={path} onRestored={() => void load()} />
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard shortcuts" size="sm">
        <ul className="space-y-2">{SHORTCUTS.map(([k, l]) => <li key={k} className="flex justify-between text-[13px]"><span className="text-ink-2">{l}</span><span className="flex gap-1">{k.split(' ').map((p) => <Kbd key={p}>{p}</Kbd>)}</span></li>)}</ul>
      </Dialog>
    </div>
  );
}
