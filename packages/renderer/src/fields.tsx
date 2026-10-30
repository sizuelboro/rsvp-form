import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  COUNTRIES, FIELD_DEFINITIONS, type AddressValue, type DietaryValue, type FileRef, type FormElement,
  type GuestCountValue, type PlusOneValue,
} from '@rsvp/core';
import { AlertIcon, CheckIcon, HeartIcon, ImageIcon, StarIcon, UploadIcon, XIcon, CalendarIcon } from './icons';
import { Markdown } from './markdown';
import { formatDateTime, useRenderer } from './context';

export interface FieldProps {
  el: FormElement;
  value: unknown;
  error?: string;
  required: boolean;
  onChange: (id: string, value: unknown) => void;
  /** Editor hook to replace the label with an inline editor */
  renderLabel?: (el: FormElement) => ReactNode;
  /** Conversational mode: called when a choice should auto-advance */
  onAdvance?: () => void;
  autoFocus?: boolean;
  /** keyboard shortcut letters for choices in conversational mode */
  showKeys?: boolean;
}

const inputId = (el: FormElement) => `fr-${el.id}`;
const describedBy = (el: FormElement, error?: string) => [el.description ? `${inputId(el)}-help` : '', error ? `${inputId(el)}-err` : ''].filter(Boolean).join(' ') || undefined;

function Shell({ el, error, required, children, renderLabel, group = false }: { el: FormElement; error?: string; required: boolean; children: ReactNode; renderLabel?: FieldProps['renderLabel']; group?: boolean }) {
  const Label = group ? 'legend' : 'label';
  const label = renderLabel ? renderLabel(el) : el.label;
  const content = (
    <>
      {(label || renderLabel) && (
        <Label className="fr-label" {...(group ? {} : { htmlFor: inputId(el) })} id={`${inputId(el)}-label`}>
          {label}
          {required && <span className="fr-req" aria-hidden="true">*</span>}
          {required && <span className="fr-hp">(required)</span>}
        </Label>
      )}
      {el.description && <p className="fr-help" id={`${inputId(el)}-help`}>{el.description}</p>}
      {children}
      {error && <div className="fr-error" id={`${inputId(el)}-err`} role="alert"><AlertIcon />{error}</div>}
    </>
  );
  return group ? <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-describedby={describedBy(el, error)}>{content}</fieldset> : <>{content}</>;
}

// ───────── basic inputs ─────────
const TYPE_ATTRS: Partial<Record<FormElement['type'], { type: string; inputMode?: 'email' | 'tel' | 'numeric' | 'decimal' | 'url'; autoComplete?: string }>> = {
  short_text: { type: 'text' }, email: { type: 'email', inputMode: 'email', autoComplete: 'email' }, phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  number: { type: 'number', inputMode: 'decimal' }, website: { type: 'url', inputMode: 'url', autoComplete: 'url' }, date: { type: 'date' }, time: { type: 'time' },
};

function guessAutocomplete(el: FormElement): string | undefined {
  if (el.type !== 'short_text') return undefined;
  const s = `${el.id} ${el.label}`.toLowerCase();
  if (/full.?name|your name|^name/.test(s)) return 'name';
  if (/company|organi[sz]ation/.test(s)) return 'organization';
  return undefined;
}

const TextField = memo(function TextField(p: FieldProps) {
  const { el, value, error, required, onChange, autoFocus } = p;
  const attrs = TYPE_ATTRS[el.type] ?? { type: 'text' };
  if (el.type === 'long_text') {
    return (
      <Shell {...p}>
        <textarea className="fr-textarea" id={inputId(el)} rows={el.config.rows ?? 4} placeholder={el.placeholder} value={(value as string) ?? ''} maxLength={el.config.maxLength ?? 10000}
          aria-invalid={Boolean(error)} aria-required={required} aria-describedby={describedBy(el, error)} autoFocus={autoFocus}
          onChange={(e) => onChange(el.id, e.target.value)} />
      </Shell>
    );
  }
  return (
    <Shell {...p}>
      <input className="fr-input" id={inputId(el)} type={attrs.type} inputMode={attrs.inputMode} autoComplete={attrs.autoComplete ?? guessAutocomplete(el)} placeholder={el.placeholder}
        value={value === undefined || value === null ? '' : String(value)} min={el.config.min} max={el.config.max} step={el.config.step}
        maxLength={el.type === 'short_text' ? el.config.maxLength ?? 500 : undefined}
        aria-invalid={Boolean(error)} aria-required={required} aria-describedby={describedBy(el, error)} autoFocus={autoFocus}
        onChange={(e) => onChange(el.id, el.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />
    </Shell>
  );
});

// ───────── choices ─────────
interface Opt { id: string; label: string; imageUrl?: string }

function OptionCard({ type, name, opt, checked, onSelect, keyHint }: { type: 'radio' | 'checkbox'; name: string; opt: Opt; checked: boolean; onSelect: () => void; keyHint?: string }) {
  return (
    <label className="fr-option" data-checked={checked}>
      <input type={type} name={name} value={opt.id} checked={checked} onChange={onSelect} />
      <span className={`fr-mark ${type === 'checkbox' ? 'fr-square' : ''}`}><CheckIcon /></span>
      <span>{opt.label}</span>
      {keyHint && <span className="fr-key" aria-hidden="true">{keyHint}</span>}
    </label>
  );
}

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const SingleChoice = memo(function SingleChoice(p: FieldProps) {
  const { el, value, onChange, onAdvance, showKeys } = p;
  const options = el.config.options ?? [];
  const isOther = typeof value === 'string' && value !== '' && !options.some((o) => o.id === value);
  const [otherOpen, setOtherOpen] = useState(isOther);
  const select = (v: string) => { setOtherOpen(false); onChange(el.id, v); onAdvance?.(); };
  return (
    <Shell {...p} group>
      <div className={`fr-options ${options.length > 4 && !showKeys ? 'fr-cols-2' : ''}`} role="radiogroup" aria-labelledby={`${inputId(el)}-label`}>
        {options.map((o, i) => <OptionCard key={o.id} type="radio" name={el.id} opt={o} checked={value === o.id} onSelect={() => select(o.id)} keyHint={showKeys ? KEYS[i] : undefined} />)}
        {el.config.allowOther && (
          <OptionCard type="radio" name={el.id} opt={{ id: '__other', label: 'Other' }} checked={otherOpen || isOther} onSelect={() => { setOtherOpen(true); onChange(el.id, ''); }} />
        )}
      </div>
      {el.config.allowOther && (otherOpen || isOther) && (
        <input className="fr-input fr-other" aria-label="Other" placeholder="Please specify" value={isOther ? (value as string) : ''} maxLength={200} onChange={(e) => onChange(el.id, e.target.value)} autoFocus />
      )}
    </Shell>
  );
});

const MultiChoice = memo(function MultiChoice(p: FieldProps) {
  const { el, value, onChange, showKeys } = p;
  const options = el.config.options ?? [];
  const list = Array.isArray(value) ? (value as string[]) : [];
  const others = list.filter((v) => !options.some((o) => o.id === v));
  const [otherOpen, setOtherOpen] = useState(others.length > 0);
  const toggle = (id: string) => onChange(el.id, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Shell {...p} group>
      <div className={`fr-options ${options.length > 4 && !showKeys ? 'fr-cols-2' : ''}`}>
        {options.map((o, i) => <OptionCard key={o.id} type="checkbox" name={el.id} opt={o} checked={list.includes(o.id)} onSelect={() => toggle(o.id)} keyHint={showKeys ? KEYS[i] : undefined} />)}
        {el.config.allowOther && <OptionCard type="checkbox" name={el.id} opt={{ id: '__other', label: 'Other' }} checked={otherOpen} onSelect={() => { setOtherOpen(!otherOpen); if (otherOpen) onChange(el.id, list.filter((v) => options.some((o) => o.id === v))); }} />}
      </div>
      {el.config.allowOther && otherOpen && (
        <input className="fr-input fr-other" aria-label="Other" placeholder="Please specify" value={others[0] ?? ''} maxLength={200}
          onChange={(e) => onChange(el.id, [...list.filter((v) => options.some((o) => o.id === v)), ...(e.target.value ? [e.target.value] : [])])} />
      )}
    </Shell>
  );
});

const Dropdown = memo(function Dropdown(p: FieldProps) {
  const { el, value, error, required, onChange, autoFocus } = p;
  const isCountry = el.type === 'country';
  return (
    <Shell {...p}>
      <select className="fr-select" id={inputId(el)} value={(value as string) ?? ''} aria-invalid={Boolean(error)} aria-required={required} aria-describedby={describedBy(el, error)} autoFocus={autoFocus}
        autoComplete={isCountry ? 'country' : undefined} onChange={(e) => onChange(el.id, e.target.value || undefined)}>
        <option value="">{el.placeholder || 'Select…'}</option>
        {isCountry ? COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>) : (el.config.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Shell>
  );
});

const YesNo = memo(function YesNo(p: FieldProps) {
  const { el, value, onChange, onAdvance, showKeys } = p;
  return (
    <Shell {...p} group>
      <div className="fr-attendance" role="radiogroup" aria-labelledby={`${inputId(el)}-label`}>
        {[{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }].map((o, i) => <OptionCard key={o.id} type="radio" name={el.id} opt={o} checked={value === o.id} onSelect={() => { onChange(el.id, o.id); onAdvance?.(); }} keyHint={showKeys ? (i ? 'N' : 'Y') : undefined} />)}
      </div>
    </Shell>
  );
});

const Rating = memo(function Rating(p: FieldProps) {
  const { el, value, onChange, onAdvance } = p;
  const scale = el.config.scale ?? 5;
  const icon = el.config.ratingIcon ?? 'star';
  const current = typeof value === 'number' ? value : 0;
  return (
    <Shell {...p} group>
      <div className="fr-rating" role="radiogroup" aria-labelledby={`${inputId(el)}-label`}>
        {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={current === n} aria-label={`${n} of ${scale}`}
            className={icon === 'number' ? 'fr-rate-num' : 'fr-rate'} data-on={icon === 'number' ? current === n : n <= current}
            onClick={() => { onChange(el.id, n); onAdvance?.(); }}>
            {icon === 'number' ? n : icon === 'heart' ? <HeartIcon filled={n <= current} /> : <StarIcon filled={n <= current} />}
          </button>
        ))}
      </div>
    </Shell>
  );
});

const ImageChoice = memo(function ImageChoice(p: FieldProps) {
  const { el, value, onChange } = p;
  const list = Array.isArray(value) ? (value as string[]) : [];
  const multiple = Boolean(el.config.multiple);
  const toggle = (id: string) => onChange(el.id, multiple ? (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]) : [id]);
  return (
    <Shell {...p} group>
      <div className="fr-images">
        {(el.config.options ?? []).map((o) => (
          <label key={o.id} className="fr-option fr-image-opt" data-checked={list.includes(o.id)}>
            <input type={multiple ? 'checkbox' : 'radio'} name={el.id} checked={list.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.imageUrl ? <img src={o.imageUrl} alt="" loading="lazy" /> : <span className="fr-image-ph"><ImageIcon /></span>}
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className={`fr-mark ${multiple ? 'fr-square' : ''}`}><CheckIcon /></span>{o.label}</span>
          </label>
        ))}
      </div>
    </Shell>
  );
});

// ───────── RSVP ─────────
const Attendance = memo(function Attendance(p: FieldProps) {
  const { el, value, onChange, onAdvance, showKeys } = p;
  const c = el.config;
  const opts = [{ id: 'accept', label: c.acceptLabel || 'Accept' }, { id: 'decline', label: c.declineLabel || 'Decline' }, ...(c.allowMaybe ? [{ id: 'maybe', label: c.maybeLabel || 'Maybe' }] : [])];
  return (
    <Shell {...p} group>
      <div className="fr-attendance" role="radiogroup" aria-labelledby={`${inputId(el)}-label`}>
        {opts.map((o, i) => <OptionCard key={o.id} type="radio" name={el.id} opt={o} checked={value === o.id} onSelect={() => { onChange(el.id, o.id); onAdvance?.(); }} keyHint={showKeys ? KEYS[i] : undefined} />)}
      </div>
    </Shell>
  );
});

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="fr-stepper">
      <span className="fr-stepper-label">{label}{hint && <small>{hint}</small>}</span>
      <span className="fr-stepper-ctrl">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </span>
    </div>
  );
}

const GuestCount = memo(function GuestCount(p: FieldProps) {
  const { el, value, onChange } = p;
  const c = el.config;
  const v = (value as GuestCountValue | undefined) ?? { adults: c.minGuests && c.minGuests > 0 ? 1 : 0, children: 0 };
  const max = c.maxGuests ?? 10;
  const total = v.adults + v.children;
  useEffect(() => { if (value === undefined && (c.minGuests ?? 1) > 0) onChange(el.id, { adults: 1, children: 0 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell {...p} group>
      <div className="fr-stepper-row">
        <Stepper label={c.splitAdultsChildren ? 'Adults' : 'Guests'} value={v.adults} min={0} max={max - v.children} onChange={(n) => onChange(el.id, { ...v, adults: n })} />
        {c.splitAdultsChildren && <Stepper label="Children" hint="Under 12" value={v.children} min={0} max={max - v.adults} onChange={(n) => onChange(el.id, { ...v, children: n })} />}
      </div>
      <p className="fr-help" style={{ marginTop: 6 }}>{total} of up to {max} {max === 1 ? 'guest' : 'guests'}</p>
    </Shell>
  );
});

const GuestNames = memo(function GuestNames(p: FieldProps) {
  const { el, value, onChange } = p;
  const names = Array.isArray(value) && value.length ? (value as string[]) : [''];
  const max = el.config.maxGuests ?? 6;
  const set = (i: number, v: string) => onChange(el.id, names.map((n, j) => (j === i ? v : n)));
  return (
    <Shell {...p} group>
      <div className="fr-names">
        {names.map((n, i) => (
          <div className="fr-name-row" key={i}>
            <input className="fr-input" aria-label={`Guest ${i + 1} name`} placeholder={`Guest ${i + 1}`} value={n} maxLength={120} onChange={(e) => set(i, e.target.value)} />
            {names.length > 1 && <button type="button" className="fr-icon-btn" aria-label={`Remove guest ${i + 1}`} onClick={() => onChange(el.id, names.filter((_, j) => j !== i))}><XIcon /></button>}
          </div>
        ))}
        {names.length < max && <div><button type="button" className="fr-link-btn" onClick={() => onChange(el.id, [...names, ''])}>+ Add another guest</button></div>}
      </div>
    </Shell>
  );
});

const PlusOne = memo(function PlusOne(p: FieldProps) {
  const { el, value, onChange } = p;
  const v = value as PlusOneValue | undefined;
  return (
    <Shell {...p} group>
      <div className="fr-attendance" role="radiogroup" aria-labelledby={`${inputId(el)}-label`}>
        <OptionCard type="radio" name={el.id} opt={{ id: 'yes', label: 'Yes, I’ll bring someone' }} checked={v?.bringing === true} onSelect={() => onChange(el.id, { bringing: true, name: v?.name })} />
        <OptionCard type="radio" name={el.id} opt={{ id: 'no', label: 'Just me' }} checked={v?.bringing === false} onSelect={() => onChange(el.id, { bringing: false })} />
      </div>
      {v?.bringing && <input className="fr-input fr-other" aria-label="Plus-one name" placeholder="Their name" value={v.name ?? ''} maxLength={120} onChange={(e) => onChange(el.id, { bringing: true, name: e.target.value })} />}
    </Shell>
  );
});

const Dietary = memo(function Dietary(p: FieldProps) {
  const { el, value, onChange } = p;
  const v = (value as DietaryValue | undefined) ?? { restrictions: [] };
  const toggle = (id: string) => onChange(el.id, { ...v, restrictions: v.restrictions.includes(id) ? v.restrictions.filter((x) => x !== id) : [...v.restrictions, id] });
  return (
    <Shell {...p} group>
      <div className="fr-options fr-cols-2">
        {(el.config.options ?? []).map((o) => <OptionCard key={o.id} type="checkbox" name={el.id} opt={o} checked={v.restrictions.includes(o.id)} onSelect={() => toggle(o.id)} />)}
      </div>
      <textarea className="fr-textarea fr-other" rows={2} aria-label="Dietary notes" placeholder="Allergies or other requirements" value={v.notes ?? ''} maxLength={1000} onChange={(e) => onChange(el.id, { ...v, notes: e.target.value })} />
    </Shell>
  );
});

const EventSelection = memo(function EventSelection(p: FieldProps) {
  const { event } = useRenderer();
  const sessions = event?.sessions ?? [];
  const el = p.el;
  // Show session times next to matching options when the form is attached to an event.
  const options = (el.config.options ?? []).map((o) => {
    const s = sessions.find((x) => x.optionId === o.id);
    return s?.startsAt ? { ...o, label: `${o.label} · ${formatDateTime(s.startsAt, event?.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` } : o;
  });
  return <MultiChoice {...p} el={{ ...el, config: { ...el.config, options, allowOther: false } }} />;
});

const DeadlineInfo = memo(function DeadlineInfo({ el }: FieldProps) {
  const { deadline, event } = useRenderer();
  return (
    <div className="fr-deadline">
      <CalendarIcon size={20} />
      <div>
        <strong>{el.label || 'Kindly respond by'}{deadline ? ` ${formatDateTime(deadline, event?.timezone, { dateStyle: 'long' })}` : ''}</strong>
        {el.config.content && <span className="fr-help" style={{ margin: 0 }}>{el.config.content}</span>}
      </div>
    </div>
  );
});

// ───────── advanced ─────────
const Address = memo(function Address(p: FieldProps) {
  const { el, value, onChange } = p;
  const v = (value as AddressValue | undefined) ?? {};
  const set = (k: keyof AddressValue, x: string) => onChange(el.id, { ...v, [k]: x });
  const field = (k: keyof AddressValue, label: string, ac: string) => <input className="fr-input" aria-label={label} placeholder={label} autoComplete={ac} value={v[k] ?? ''} maxLength={200} onChange={(e) => set(k, e.target.value)} />;
  return (
    <Shell {...p} group>
      <div className="fr-address">
        {field('line1', 'Street address', 'address-line1')}
        {field('line2', 'Apartment, suite (optional)', 'address-line2')}
        {field('city', 'City', 'address-level2')}
        {field('state', 'State / Province', 'address-level1')}
        {field('postalCode', 'Postal code', 'postal-code')}
        <select className="fr-select" aria-label="Country" autoComplete="country" value={v.country ?? ''} onChange={(e) => set('country', e.target.value)}>
          <option value="">Country</option>
          {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
    </Shell>
  );
});

const Signature = memo(function Signature(p: FieldProps) {
  const { el, value, onChange } = p;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const has = typeof value === 'string' && value.length > 0;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = getComputedStyle(c).color || '#222';
    if (has) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.offsetWidth, c.offsetHeight); img.src = value as string; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <Shell {...p} group>
      <div className="fr-signature">
        <canvas ref={canvas} aria-label="Signature pad. Draw your signature." role="img"
          onPointerDown={(e) => { drawing.current = true; canvas.current!.setPointerCapture(e.pointerId); const ctx = canvas.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
          onPointerMove={(e) => { if (!drawing.current) return; const ctx = canvas.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); }}
          onPointerUp={() => { drawing.current = false; onChange(el.id, canvas.current!.toDataURL('image/png')); }} />
        {!has && <span className="fr-signature-hint">Sign here</span>}
        {has && <span className="fr-signature-actions"><button type="button" className="fr-link-btn" onClick={() => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); onChange(el.id, undefined); }}>Clear</button></span>}
      </div>
    </Shell>
  );
});

const FileUpload = memo(function FileUpload(p: FieldProps) {
  const { el, value, onChange } = p;
  const { upload, mode } = useRenderer();
  const files = Array.isArray(value) ? (value as FileRef[]) : [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const max = el.config.maxFiles ?? 1;
  const handle = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr(null);
    const picked = Array.from(list).slice(0, max - files.length);
    const limit = (el.config.maxFileSizeMb ?? 10) * 1024 * 1024;
    const tooBig = picked.find((f) => f.size > limit);
    if (tooBig) { setErr(`${tooBig.name} is larger than ${el.config.maxFileSizeMb ?? 10} MB`); return; }
    if (!upload || mode !== 'live') {
      onChange(el.id, [...files, ...picked.map((f) => ({ key: `uploads/preview/${el.id}/${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`, name: f.name, size: f.size, type: f.type }))]);
      return;
    }
    setBusy(true);
    try {
      const uploaded: FileRef[] = [];
      for (const f of picked) uploaded.push(await upload(el.id, f));
      onChange(el.id, [...files, ...uploaded]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell {...p} group>
      {files.length < max && (
        <div className="fr-drop" data-drag={drag} role="button" tabIndex={0} aria-label="Upload a file"
          onClick={() => ref.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ref.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); }}>
          {busy ? <span className="fr-spinner" style={{ display: 'inline-block' }} /> : <UploadIcon />}
          <div style={{ marginTop: 6 }}>{busy ? 'Uploading…' : 'Click to upload or drag and drop'}</div>
          <div style={{ fontSize: '.82em', marginTop: 2 }}>{(el.config.accept ?? []).map((a) => a.replace('application/', '').replace('/*', ' images').toUpperCase()).join(', ')} · up to {el.config.maxFileSizeMb ?? 10} MB</div>
          <input ref={ref} type="file" hidden accept={(el.config.accept ?? []).join(',')} multiple={max > 1} onChange={(e) => { void handle(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {files.length > 0 && (
        <ul className="fr-files">
          {files.map((f, i) => (
            <li key={f.key}><span>{f.name} <span className="fr-help" style={{ display: 'inline' }}>· {(f.size / 1024 / 1024).toFixed(1)} MB</span></span>
              <button type="button" className="fr-link-btn" aria-label={`Remove ${f.name}`} onClick={() => onChange(el.id, files.filter((_, j) => j !== i))}>Remove</button></li>
          ))}
        </ul>
      )}
      {err && <div className="fr-error" role="alert"><AlertIcon />{err}</div>}
    </Shell>
  );
});

const Payment = memo(function Payment(p: FieldProps) {
  const { el } = p;
  let amount = `${el.config.currency ?? 'INR'} ${el.config.amount ?? 0}`;
  try { amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: el.config.currency ?? 'INR' }).format(el.config.amount ?? 0); } catch { /* keep fallback */ }
  return (
    <Shell {...p} required={false}>
      <div className="fr-payment"><span>Amount due</span><strong>{amount}</strong></div>
      <p className="fr-help" style={{ marginTop: 6 }}>Payment details will be collected securely after you submit.</p>
    </Shell>
  );
});

// ───────── content ─────────
function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get('v')!)}`;
    if (u.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) { const id = u.pathname.split('/').filter(Boolean).pop(); return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null; }
  } catch { /* invalid */ }
  return null;
}

const Content = memo(function Content({ el, renderLabel }: FieldProps) {
  const c = el.config;
  switch (el.type) {
    case 'heading': {
      const Tag = (`h${c.level ?? 2}`) as 'h1' | 'h2' | 'h3';
      return <Tag className={`fr-heading fr-h${c.level ?? 2}`}>{renderLabel ? renderLabel(el) : el.label}</Tag>;
    }
    case 'paragraph': return <p className="fr-paragraph">{c.content}</p>;
    case 'rich_text': return <Markdown source={c.content ?? ''} />;
    case 'image': return c.url && /^https?:\/\//.test(c.url) ? <img className="fr-media" src={c.url} alt={c.alt ?? ''} loading="lazy" /> : <div className="fr-media-ph">Add an image URL in the inspector</div>;
    case 'video': { const src = c.url ? embedUrl(c.url) : null; return src ? <div className="fr-video"><iframe src={src} title={el.label || 'Video'} allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" /></div> : <div className="fr-media-ph">Paste a YouTube or Vimeo link in the inspector</div>; }
    case 'divider': return <hr className="fr-divider" />;
    case 'spacer': return <div style={{ height: c.height ?? 32 }} aria-hidden="true" />;
    case 'section': return <div className="fr-section"><h3 className="fr-section-title">{renderLabel ? renderLabel(el) : el.label}</h3>{c.content && <p className="fr-help" style={{ marginTop: 4 }}>{c.content}</p>}</div>;
    default: return null;
  }
});

const COMPONENTS: Partial<Record<FormElement['type'], React.ComponentType<FieldProps>>> = {
  short_text: TextField, long_text: TextField, email: TextField, phone: TextField, number: TextField, website: TextField, date: TextField, time: TextField,
  single_choice: SingleChoice, multiple_choice: MultiChoice, dropdown: Dropdown, yes_no: YesNo, rating: Rating, image_choice: ImageChoice,
  attendance: Attendance, guest_count: GuestCount, guest_names: GuestNames, plus_one: PlusOne, meal_preference: SingleChoice, dietary: Dietary,
  accommodation: SingleChoice, transportation: SingleChoice, event_selection: EventSelection, rsvp_deadline_info: DeadlineInfo,
  file_upload: FileUpload, signature: Signature, address: Address, country: Dropdown, payment: Payment,
  heading: Content, paragraph: Content, image: Content, video: Content, divider: Content, spacer: Content, section: Content, rich_text: Content,
};

/** Renders any element. Used identically by the public renderer, editor canvas and preview. */
export const FieldView = memo(function FieldView(props: FieldProps & { className?: string }) {
  const { el } = props;
  if (el.type === 'hidden') return null;
  const Comp = COMPONENTS[el.type];
  if (!Comp) return null;
  const s = el.style ?? {};
  const style: React.CSSProperties = {
    ...(s.background ? { background: s.background, padding: 16, borderRadius: s.radius ?? undefined } : {}),
    ...(s.borderColor ? { border: `1px solid ${s.borderColor}`, padding: 16, borderRadius: s.radius ?? undefined } : {}),
    ...(s.paddingY !== undefined ? { paddingTop: s.paddingY, paddingBottom: s.paddingY } : {}),
    ...(s.fontSize ? { fontSize: s.fontSize } : {}),
    ...(s.fontWeight ? { fontWeight: s.fontWeight } : {}),
  };
  return (
    <div className={`fr-field ${s.width === 'half' ? 'fr-half' : ''} ${s.size ? `fr-size-${s.size}` : ''} ${props.className ?? ''}`} data-align={s.align} data-field={el.id} data-type={el.type} style={style}>
      <Comp {...props} />
    </div>
  );
});

export const isInput = (el: FormElement) => FIELD_DEFINITIONS[el.type].isInput;
