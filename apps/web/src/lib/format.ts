export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function fmtDate(iso: string | null | undefined, tz?: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(new Date(iso)); } catch { return new Date(iso).toLocaleDateString(); }
}

export function fmtDateTime(iso: string | null | undefined, tz?: string): string {
  return fmtDate(iso, tz, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const n = (v: number | null | undefined) => new Intl.NumberFormat().format(v ?? 0);

/** Convert a UTC ISO string to a value for <input type="datetime-local"> in the given time zone. */
export function isoToLocalInput(iso: string | null | undefined, tz = 'UTC'): string {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Interpret a datetime-local value as wall-clock time in `tz` and return a UTC ISO string. */
export function localInputToIso(value: string, tz = 'UTC'): string | null {
  if (!value) return null;
  const asUtc = new Date(`${value}:00Z`);
  // Find the offset of tz at that instant and correct for it (twice handles DST edges).
  let guess = asUtc.getTime();
  for (let i = 0; i < 2; i++) {
    const local = isoToLocalInput(new Date(guess).toISOString(), tz);
    const diff = new Date(`${local}:00Z`).getTime() - guess;
    guess = asUtc.getTime() - diff;
  }
  return new Date(guess).toISOString();
}

export const TIMEZONES: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York']; }
})();

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
