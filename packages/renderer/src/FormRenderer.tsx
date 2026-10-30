import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  evaluateLogic, interpolate, formatAnswer, nextPageIndex, validateAnswers, FIELD_DEFINITIONS, allElements,
  type Answers, type FileRef, type FormElement, type FormSchema, type LogicState,
} from '@rsvp/core';
import { FieldView } from './fields';
import { RendererContext, type PublicEventInfo, type RendererContextValue } from './context';
import { Confirmation, EventDetails } from './Confirmation';
import { ArrowLeftIcon, ArrowRightIcon } from './icons';
import { ThemeScope } from './theme';

export interface SubmitResult {
  submissionId: string;
  confirmation: { title: string; message: string; redirectUrl?: string | null };
  event?: PublicEventInfo | null;
  checkinToken?: string | null;
}

export class SubmitError extends Error {
  constructor(message: string, public fields?: Record<string, string>) { super(message); }
}

export interface FormRendererProps {
  schema: FormSchema;
  mode?: 'live' | 'preview';
  event?: PublicEventInfo | null;
  deadline?: string | null;
  initialAnswers?: Answers;
  query?: Record<string, string>;
  /** persist in-progress answers to localStorage under this key */
  storageKey?: string;
  onSubmit?: (answers: Answers, meta: { startedAt: number; honeypot: string }) => Promise<SubmitResult>;
  onStart?: () => void;
  upload?: (fieldId: string, file: File) => Promise<FileRef>;
  checkinUrl?: (token: string) => string;
  hideBranding?: boolean;
  /** render without the outer page background (editor preview frame) */
  embedded?: boolean;
  allowEdit?: boolean;
}

function useFormState(schema: FormSchema, initial: Answers | undefined, storageKey?: string) {
  const [answers, setAnswers] = useState<Answers>(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      try { const saved = localStorage.getItem(storageKey); if (saved) return { ...JSON.parse(saved), ...initial }; } catch { /* ignore */ }
    }
    return initial ?? {};
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const logic: LogicState = useMemo(() => evaluateLogic(schema, answers), [schema, answers]);
  const setAnswer = useCallback((id: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setErrors((e) => (e[id] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)) : e));
  }, []);
  useEffect(() => {
    if (!storageKey) return;
    const t = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(answers)); } catch { /* quota */ } }, 400);
    return () => clearTimeout(t);
  }, [answers, storageKey]);
  return { answers, setAnswers, errors, setErrors, logic, setAnswer };
}

function focusFirstError(errors: Record<string, string>) {
  const id = Object.keys(errors)[0];
  if (!id || typeof document === 'undefined') return;
  // element ids are validated as [a-z0-9_], so they are safe inside an attribute selector
  const node = document.querySelector<HTMLElement>(`[data-field="${id}"]`);
  node?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  node?.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
}

export function FormRenderer(props: FormRendererProps) {
  const { schema, mode = 'live', event = null, deadline = null } = props;
  const ctx: RendererContextValue = useMemo(() => ({ mode, event, deadline, upload: props.upload }), [mode, event, deadline, props.upload]);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const state = useFormState(schema, props.initialAnswers, mode === 'live' ? props.storageKey : undefined);
  const startedAt = useRef(Date.now());
  const started = useRef(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const onChange = useCallback((id: string, v: unknown) => {
    if (!started.current) { started.current = true; props.onStart?.(); }
    state.setAnswer(id, v);
  }, [state.setAnswer, props.onStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const v = validateAnswers(schema, state.answers, { query: props.query });
    if (!v.ok) { state.setErrors(v.errors); setTimeout(() => focusFirstError(v.errors)); return false; }
    setSubmitting(true);
    setBanner(null);
    try {
      const res = props.onSubmit
        ? await props.onSubmit(state.answers, { startedAt: startedAt.current, honeypot: honeypot.current?.value ?? '' })
        : previewResult(schema, v.cleaned, event);
      if (props.storageKey) try { localStorage.removeItem(props.storageKey); } catch { /* ignore */ }
      if (res.confirmation.redirectUrl && mode === 'live' && /^https?:\/\//.test(res.confirmation.redirectUrl)) { window.location.assign(res.confirmation.redirectUrl); return true; }
      setResult(res);
      setTimeout(() => document.querySelector<HTMLElement>('.fr-confirm .fr-title')?.focus());
      return true;
    } catch (e) {
      if (e instanceof SubmitError && e.fields && Object.keys(e.fields).length) { state.setErrors(e.fields); setTimeout(() => focusFirstError(e.fields!)); }
      setBanner(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const layout = schema.settings.layout;
  const body = result ? (
    <Confirmation title={result.confirmation.title} message={result.confirmation.message} event={result.event ?? null}
      checkinUrl={result.checkinToken ? (props.checkinUrl?.(result.checkinToken) ?? null) : null}
      onEdit={props.allowEdit ? () => setResult(null) : undefined} />
  ) : layout === 'conversational' ? (
    <Conversational schema={schema} state={state} onChange={onChange} submit={submit} submitting={submitting} />
  ) : layout === 'multistep' ? (
    <MultiStep schema={schema} state={state} onChange={onChange} submit={submit} submitting={submitting} event={event} />
  ) : (
    <Standard schema={schema} state={state} onChange={onChange} submit={submit} submitting={submitting} event={event} />
  );

  const inner = (
    <div className="fr-shell">
      {schema.settings.coverImage && !result && layout !== 'conversational' && <img className="fr-cover" src={schema.settings.coverImage} alt="" />}
      <div className="fr-card">
        {schema.settings.logoUrl && <img className="fr-logo" src={schema.settings.logoUrl} alt="" />}
        {body}
        {banner && <div className="fr-banner" role="alert">{banner}</div>}
        <input ref={honeypot} className="fr-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website_url" />
      </div>
      {!props.hideBranding && <div className="fr-footer">Made with <a href="/" target="_blank" rel="noopener">Invitely</a></div>}
    </div>
  );

  return (
    <RendererContext.Provider value={ctx}>
      <ThemeScope theme={schema.theme} fullPage={!props.embedded}>{inner}</ThemeScope>
    </RendererContext.Provider>
  );
}

function previewResult(schema: FormSchema, answers: Answers, event: PublicEventInfo | null): SubmitResult {
  const vars: Record<string, string> = {};
  for (const el of allElements(schema)) if (answers[el.id] !== undefined) vars[el.id] = formatAnswer(el, answers[el.id]);
  const declined = allElements(schema).some((el) => el.type === 'attendance' && answers[el.id] === 'decline');
  const c = schema.settings.confirmation;
  return {
    submissionId: 'preview',
    confirmation: { title: interpolate(c.title, vars), message: interpolate(declined && c.declineMessage ? c.declineMessage : c.message, vars) },
    event: c.showEventDetails ? event : null,
    checkinToken: c.showQrCode && !declined && allElements(schema).some((el) => el.type === 'attendance') ? 'preview-token-0000000000' : null,
  };
}

type State = ReturnType<typeof useFormState>;
interface ModeProps { schema: FormSchema; state: State; onChange: (id: string, v: unknown) => void; submit: () => Promise<boolean>; submitting: boolean; event?: PublicEventInfo | null }

function Header({ schema, event }: { schema: FormSchema; event?: PublicEventInfo | null }) {
  return (
    <header className="fr-header">
      <h1 className="fr-title">{schema.form.title}</h1>
      {schema.form.description && <p className="fr-desc">{schema.form.description}</p>}
      {event && <EventDetails event={event} />}
    </header>
  );
}

function Elements({ elements, state, onChange }: { elements: FormElement[]; state: State; onChange: ModeProps['onChange'] }) {
  return (
    <div className="fr-fields">
      {elements.filter((el) => !state.logic.hidden.has(el.id)).map((el) => (
        <FieldView key={el.id} el={el} value={state.answers[el.id]} error={state.errors[el.id]} required={state.logic.required.get(el.id) ?? false} onChange={onChange} />
      ))}
    </div>
  );
}

function Messages({ state }: { state: State }) {
  if (!state.logic.messages.length) return null;
  return <div className="fr-messages" aria-live="polite">{state.logic.messages.map((m) => <div key={m.ruleId} className="fr-notice">{m.message}</div>)}</div>;
}

function SubmitButton({ label, submitting }: { label: string; submitting: boolean }) {
  return <button type="submit" className="fr-btn" disabled={submitting}>{submitting && <span className="fr-spinner" />}{submitting ? 'Submitting…' : label}</button>;
}

function Standard({ schema, state, onChange, submit, submitting, event }: ModeProps) {
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void submit(); };
  return (
    <form onSubmit={onSubmit} noValidate>
      <Header schema={schema} event={event} />
      {state.logic.path.map((pi) => {
        const page = schema.pages[pi]!;
        return (
          <section className="fr-page" key={page.id} aria-label={page.title || undefined}>
            {page.title && <h2 className="fr-page-title">{page.title}</h2>}
            {page.description && <p className="fr-help">{page.description}</p>}
            <Elements elements={page.elements} state={state} onChange={onChange} />
          </section>
        );
      })}
      <Messages state={state} />
      <div className="fr-actions"><span /><SubmitButton label={schema.settings.submitLabel} submitting={submitting} /></div>
    </form>
  );
}

function MultiStep({ schema, state, onChange, submit, submitting, event }: ModeProps) {
  const [current, setCurrent] = useState(() => state.logic.path[0] ?? 0);
  const [history, setHistory] = useState<number[]>([]);
  const top = useRef<HTMLDivElement>(null);
  const path = state.logic.path;
  const pos = Math.max(0, path.indexOf(current));
  const next = nextPageIndex(schema, state.answers, current);
  const isLast = next === -1;
  const page = schema.pages[current] ?? schema.pages[0]!;

  const go = (idx: number) => { setCurrent(idx); setTimeout(() => { top.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); top.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }); }); };
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateAnswers(schema, state.answers, { pages: [current] });
    if (!v.ok) { state.setErrors(v.errors); setTimeout(() => focusFirstError(v.errors)); return; }
    if (isLast) { await submit(); return; }
    setHistory((h) => [...h, current]);
    go(next);
  };
  const back = () => { const prev = history[history.length - 1]; if (prev === undefined) return; setHistory((h) => h.slice(0, -1)); go(prev); };

  return (
    <form onSubmit={onSubmit} noValidate>
      <div ref={top} />
      {pos === 0 && <Header schema={schema} event={event} />}
      {schema.settings.showProgress && path.length > 1 && (
        <>
          <div className="fr-steps"><span>Step {pos + 1} of {path.length}</span><span>{page.title}</span></div>
          <div className="fr-progress" role="progressbar" aria-valuemin={0} aria-valuemax={path.length} aria-valuenow={pos + 1}><div style={{ width: `${((pos + 1) / path.length) * 100}%` }} /></div>
        </>
      )}
      <section className="fr-page" key={page.id}>
        {page.title && <h2 className="fr-page-title" tabIndex={-1}>{page.title}</h2>}
        {page.description && <p className="fr-help">{page.description}</p>}
        <Elements elements={page.elements} state={state} onChange={onChange} />
      </section>
      <Messages state={state} />
      <div className="fr-actions">
        {history.length ? <button type="button" className="fr-btn fr-btn-ghost" onClick={back}><ArrowLeftIcon /> Back</button> : <span />}
        {isLast ? <SubmitButton label={schema.settings.submitLabel} submitting={submitting} /> : <button type="submit" className="fr-btn">Next <ArrowRightIcon /></button>}
      </div>
    </form>
  );
}

const AUTO_ADVANCE: FormElement['type'][] = ['single_choice', 'yes_no', 'attendance', 'rating', 'meal_preference', 'accommodation', 'transportation'];
const SKIP_IN_CONVO: FormElement['type'][] = ['hidden', 'spacer', 'divider'];

function Conversational({ schema, state, onChange, submit, submitting }: ModeProps) {
  const steps = useMemo(() => state.logic.path.flatMap((pi) => schema.pages[pi]!.elements).filter((el) => !state.logic.hidden.has(el.id) && !SKIP_IN_CONVO.includes(el.type)), [schema, state.logic]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [intro, setIntro] = useState(true);
  const index = Math.max(0, currentId ? steps.findIndex((s) => s.id === currentId) : 0);
  const el = steps[index];
  const inputCount = steps.filter((s) => FIELD_DEFINITIONS[s.type].isInput).length;
  const qNumber = steps.slice(0, index + 1).filter((s) => FIELD_DEFINITIONS[s.type].isInput).length;
  const isLast = index >= steps.length - 1;
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();

  const validateCurrent = (): boolean => {
    if (!el || !FIELD_DEFINITIONS[el.type].isInput) return true;
    const page = schema.pages.findIndex((p) => p.elements.some((e) => e.id === el.id));
    const v = validateAnswers(schema, state.answers, { pages: [page] });
    if (v.errors[el.id]) { state.setErrors({ [el.id]: v.errors[el.id]! }); return false; }
    return true;
  };
  const next = async () => {
    if (!validateCurrent()) return;
    if (isLast) { await submit(); return; }
    setDir('fwd');
    setCurrentId(steps[index + 1]!.id);
  };
  const back = () => { if (index === 0) { setIntro(true); return; } setDir('back'); setCurrentId(steps[index - 1]!.id); };
  // Auto-advance fires after the answer has re-rendered; call the *latest* `next` so validation and
  // the step list reflect the new answer (e.g. a follow-up question revealed by logic).
  const nextRef = useRef(next);
  nextRef.current = next;
  const onAdvance = () => { clearTimeout(advanceTimer.current); advanceTimer.current = setTimeout(() => { void nextRef.current(); }, 350); };
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'radio' && (target as HTMLInputElement).type !== 'checkbox');
    if (e.key === 'Enter' && !e.shiftKey && (target.tagName !== 'TEXTAREA' || e.metaKey || e.ctrlKey) && target.tagName !== 'BUTTON') {
      e.preventDefault();
      if (intro) setIntro(false); else void next();
      return;
    }
    if (!typing && el && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-z]$/i.test(e.key)) {
      const k = e.key.toUpperCase();
      if (el.type === 'yes_no' && (k === 'Y' || k === 'N')) { onChange(el.id, k === 'Y' ? 'yes' : 'no'); onAdvance(); return; }
      const opts = el.type === 'attendance'
        ? ['accept', 'decline', ...(el.config.allowMaybe ? ['maybe'] : [])]
        : ['single_choice', 'meal_preference', 'accommodation', 'transportation', 'multiple_choice'].includes(el.type) ? (el.config.options ?? []).map((o) => o.id) : [];
      const pick = opts['ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(k)];
      if (pick) {
        if (el.type === 'multiple_choice') {
          const list = Array.isArray(state.answers[el.id]) ? (state.answers[el.id] as string[]) : [];
          onChange(el.id, list.includes(pick) ? list.filter((x) => x !== pick) : [...list, pick]);
        } else { onChange(el.id, pick); onAdvance(); }
      }
    }
  };

  if (intro) {
    return (
      <form className="fr-convo" onKeyDown={onKeyDown} onSubmit={(e) => { e.preventDefault(); setIntro(false); }}>
        <div className="fr-convo-q">
          <h1 className="fr-title">{schema.form.title}</h1>
          {schema.form.description && <p className="fr-desc">{schema.form.description}</p>}
          <div className="fr-actions" style={{ justifyContent: 'flex-start' }}><button type="submit" className="fr-btn" autoFocus>Start <ArrowRightIcon /></button><span className="fr-convo-hint">press Enter ↵</span></div>
        </div>
      </form>
    );
  }
  if (!el) return null;
  const isInput = FIELD_DEFINITIONS[el.type].isInput;
  return (
    <form className="fr-convo" onKeyDown={onKeyDown} onSubmit={(e) => { e.preventDefault(); void next(); }} noValidate>
      {schema.settings.showProgress && <div className="fr-progress" role="progressbar" aria-valuemin={0} aria-valuemax={inputCount} aria-valuenow={qNumber}><div style={{ width: `${(qNumber / Math.max(1, inputCount)) * 100}%` }} /></div>}
      <div className="fr-convo-q" key={el.id} data-dir={dir}>
        {isInput && <div className="fr-convo-num">{qNumber} <ArrowRightIcon width={12} height={12} /></div>}
        <FieldView el={el} value={state.answers[el.id]} error={state.errors[el.id]} required={state.logic.required.get(el.id) ?? false}
          onChange={onChange} onAdvance={AUTO_ADVANCE.includes(el.type) ? onAdvance : undefined} autoFocus showKeys />
        <Messages state={state} />
        <div className="fr-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="submit" className="fr-btn" disabled={submitting}>{submitting && <span className="fr-spinner" />}{isLast ? schema.settings.submitLabel : 'OK'} {!isLast && <ArrowRightIcon />}</button>
          <span className="fr-convo-hint">{el.type === 'long_text' ? 'Ctrl + Enter ↵' : 'press Enter ↵'}</span>
          <button type="button" className="fr-btn fr-btn-ghost" style={{ marginLeft: 'auto' }} onClick={back} aria-label="Previous question"><ArrowLeftIcon /></button>
        </div>
      </div>
    </form>
  );
}
