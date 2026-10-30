import { cloneElement, forwardRef, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-xs border border-brand-600/40',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-hover shadow-xs',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  danger: 'bg-danger text-white hover:brightness-95 shadow-xs',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-md',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-md justify-center',
  'icon-sm': 'h-7 w-7 rounded-md justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} type="button" disabled={disabled || loading}
      className={cn('inline-flex items-center font-medium whitespace-nowrap transition-colors duration-100 select-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer', variants[variant], sizes[size], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

const hasWidth = (c?: string) => Boolean(c && /(^|\s)(w-|min-w-|flex-1)/.test(c));
const inputBase = 'bg-surface border border-line-strong rounded-md text-[13.5px] text-ink placeholder:text-faint transition-shadow outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 disabled:bg-hover disabled:text-muted aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input({ className, icon, ...rest }, ref) {
  if (icon) {
    return (
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none [&>svg]:size-4">{icon}</span>
        <input ref={ref} className={cn(inputBase, 'w-full h-9 pl-8 pr-3', className)} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cn(inputBase, !hasWidth(className) && 'w-full', 'h-9 px-3', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(inputBase, 'w-full px-3 py-2 min-h-[72px] resize-y leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(inputBase, !hasWidth(className) && 'w-full', 'h-9 pl-3 pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%23777786%27%20stroke-width=%272%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center] cursor-pointer', className)} {...rest}>
      {children}
    </select>
  );
});

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; id?: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50', checked ? 'bg-brand-500' : 'bg-line-strong')}>
      <span className={cn('absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-4')} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate, className }: { checked: boolean; onChange: (v: boolean) => void; label?: string; indeterminate?: boolean; className?: string }) {
  return (
    <input type="checkbox" aria-label={label} checked={checked} ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate); }} onChange={(e) => onChange(e.target.checked)}
      className={cn('size-4 rounded border-line-strong accent-brand-500 cursor-pointer', className)} />
  );
}

export function Field({ label, hint, error, children, htmlFor, className, aside }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string; aside?: ReactNode }) {
  // Associate the label with a single form control automatically so every field is accessible.
  const autoId = useId();
  const childId = isValidElement<{ id?: string }>(children) ? children.props.id : undefined;
  const id = htmlFor ?? childId ?? autoId;
  const control = isValidElement<{ id?: string }>(children) && !childId ? cloneElement(children, { id }) : children;
  return (
    <div className={className}>
      {label && <div className="flex items-center justify-between"><label className="label" htmlFor={id}>{label}</label>{aside}</div>}
      {control}
      {error ? <p className="text-[12px] text-danger mt-1.5">{error}</p> : hint ? <p className="hint mt-1.5">{hint}</p> : null}
    </div>
  );
}

const tones = {
  neutral: 'bg-hover text-ink-2 border-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  success: 'bg-success-50 text-success border-success/15',
  warning: 'bg-warning-50 text-warning border-warning/15',
  danger: 'bg-danger-50 text-danger border-danger/15',
  coral: 'bg-coral-50 text-[#B4513E] border-coral-500/20',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border text-[12px] font-medium whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('size-4 animate-spin text-muted', className)} />;

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-line/70', className)} />;

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span className={cn('inline-grid place-items-center rounded-full font-semibold shrink-0 text-[11px]', className)} style={{ width: size, height: size, background: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 35% 32%)` }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
