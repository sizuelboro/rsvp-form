import { useMemo, useState } from 'react';

/** Fill a sparse {day, n} series with zeros so the x-axis is continuous. */
export function fillDays(rows: { day: string; [k: string]: unknown }[], days: number, end = new Date(), keys: string[] = ['n']) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: Record<string, number | string>[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    const r = map.get(d);
    out.push({ day: d, ...Object.fromEntries(keys.map((k) => [k, Number(r?.[k] ?? 0)])) });
  }
  return out;
}

export function LineChart({ data, series, height = 180 }: { data: Record<string, number | string>[]; series: { key: string; label: string; color: string }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, P = { l: 30, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - P.b - (v / niceMax) * (H - P.t - P.b);
  const ticks = [0, niceMax / 2, niceMax];
  const labelEvery = Math.ceil(data.length / 6);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={`Chart of ${series.map((s) => s.label).join(', ')}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (data.length - 1))))); }}>
        {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#ECEAE4" strokeDasharray={t ? '3 4' : undefined} /><text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#A3A3B0">{t}</text></g>)}
        {data.map((d, i) => i % labelEvery === 0 && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#A3A3B0">{new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text>)}
        {series.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`).join(' ');
          return (
            <g key={s.key}>
              {series.length === 1 && <polygon points={`${x(0)},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}`} fill={s.color} opacity="0.07" />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#DEDBD3" />}
        {hover !== null && series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover]?.[s.key]) || 0)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2" />)}
      </svg>
      {hover !== null && data[hover] && (
        <div className="absolute top-1 pointer-events-none bg-ink text-white rounded-md px-2.5 py-1.5 text-[11.5px] shadow-md" style={{ left: `min(calc(${(x(hover) / W) * 100}% + 8px), calc(100% - 140px))` }}>
          <div className="text-white/60">{new Date(`${data[hover]!.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
          {series.map((s) => <div key={s.key} className="flex gap-2 items-center"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}: <b>{data[hover]![s.key]}</b></div>)}
        </div>
      )}
    </div>
  );
}

export function BarList({ items, color = '#5146D8', format = (v: number) => String(v) }: { items: { label: string; value: number; sub?: string }[]; color?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!items.length) return <p className="text-[13px] text-muted py-4">No data yet</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="flex justify-between text-[13px] mb-1"><span className="text-ink-2 truncate pr-3">{it.label}</span><span className="tabular text-ink font-medium">{format(it.value)}<span className="text-faint font-normal ml-1.5">{total ? Math.round((it.value / total) * 100) : 0}%</span></span></div>
          <div className="h-1.5 rounded-full bg-hover overflow-hidden"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(it.value / max) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ segments, size = 132, label, sublabel }: { segments: { label: string; value: number; color: string }[]; size?: number; label?: string; sublabel?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 42, c = 2 * Math.PI * r;
  const arcs = useMemo(() => {
    let off = 0;
    return segments.map((s) => { const len = total ? (s.value / total) * c : 0; const a = { ...s, len, off }; off += len; return a; });
  }, [segments, total, c]);
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#F4F2EE" strokeWidth="11" />
        {arcs.map((a) => a.len > 0 && <circle key={a.label} cx="50" cy="50" r={r} fill="none" stroke={a.color} strokeWidth="11" strokeDasharray={`${a.len} ${c - a.len}`} strokeDashoffset={-a.off} transform="rotate(-90 50 50)" />)}
        {label && <text x="50" y="49" textAnchor="middle" fontSize="16" fontWeight="600" fill="#232334">{label}</text>}
        {sublabel && <text x="50" y="62" textAnchor="middle" fontSize="8" fill="#777786">{sublabel}</text>}
      </svg>
      <ul className="space-y-1.5 text-[13px]">
        {segments.map((s) => <li key={s.label} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-ink-2">{s.label}</span><span className="tabular font-medium ml-auto pl-4">{s.value}</span></li>)}
      </ul>
    </div>
  );
}
