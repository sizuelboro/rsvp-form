import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button, cn, Input, Skeleton } from './primitives';

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
          {description && <p className="text-[13.5px] text-muted mt-1">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-8 px-4' : 'py-16 px-6')}>
      {icon && <div className="size-11 rounded-xl bg-brand-50 text-brand-500 grid place-items-center mb-4 [&>svg]:size-5">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="text-[13px] text-muted mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string }; onRetry?: () => void }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-[13.5px] text-ink font-medium">Couldn’t load this</p>
      <p className="text-[13px] text-muted mt-1">{error.message}</p>
      {onRetry && <Button className="mt-4" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn('flex gap-1 border-b border-line overflow-x-auto', className)} role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cn('relative h-10 px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors cursor-pointer', value === it.value ? 'text-ink' : 'text-muted hover:text-ink')}>
          <span className="flex items-center gap-1.5">{it.label}{it.count !== undefined && <span className="text-[11.5px] text-faint tabular">{it.count}</span>}</span>
          {value === it.value && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-ink" />}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items, size = 'md' }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; title?: string }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-hover border border-line" role="radiogroup">
      {items.map((it) => (
        <button key={it.value} role="radio" aria-checked={value === it.value} title={it.title} aria-label={it.title} onClick={() => onChange(it.value)}
          className={cn('inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all cursor-pointer [&>svg]:size-4', size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === it.value ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <div className={cn('w-full sm:w-64', className)}><Input icon={<Search />} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="text-[12.5px] text-muted px-4 py-3">{total} {total === 1 ? 'item' : 'items'}</div>;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-muted">
      <span className="tabular">{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="flex gap-1">
        <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
        <Button size="icon-sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: 'success' | 'danger' | 'warning' | 'brand' }) {
  const dot = accent ? { success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning', brand: 'bg-brand-500' }[accent] : null;
  return (
    <div className="card px-4 py-3.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[12.5px] text-muted">{dot && <span className={cn('size-1.5 rounded-full', dot)} />}{label}</div>
      <div className="text-[22px] font-semibold tracking-tight text-ink mt-1 tabular truncate">{value}</div>
      {hint && <div className="text-[12px] text-faint mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string; headerClassName?: string }

export function Table<T>({ columns, rows, rowKey, onRowClick, loading, empty, selectable }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; loading?: boolean; empty?: ReactNode; selectable?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => <th key={c.key} scope="col" className={cn('text-left font-medium text-muted text-[12px] h-9 px-4 whitespace-nowrap', c.headerClassName)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length && Array.from({ length: 5 }, (_, i) => (
            <tr key={i} className="border-b border-line last:border-0">{columns.map((c) => <td key={c.key} className="px-4 h-12"><Skeleton className="h-3.5 w-3/4" /></td>)}</tr>
          ))}
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('border-b border-line last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-hover/60', selectable && 'group')}>
              {columns.map((c) => <td key={c.key} className={cn('px-4 h-12 align-middle', c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && !rows.length && empty}
    </div>
  );
}
