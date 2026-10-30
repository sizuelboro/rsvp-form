import { FONTS, FONT_KEYS, getPreset, resolveTheme, THEME_PRESETS, type ThemeOverrides } from '@rsvp/core';
import { Check, RotateCcw } from 'lucide-react';
import { Button, Field, Select, Segmented, cn } from '../../components/ui';
import { UrlInput } from './UrlInput';
import { useEditor } from './store';
import { ColorField, Row, Section } from './Inspector';

function Slider({ value, min, max, step = 1, onChange, unit = '' }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div className="flex items-center gap-2 w-[160px]">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-brand-500 cursor-pointer" />
      <span className="text-[11.5px] text-muted tabular w-10 text-right">{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</span>
    </div>
  );
}

export function ThemePanel() {
  const theme = useEditor((s) => s.schema!.theme);
  const setPreset = useEditor((s) => s.setThemePreset);
  const set = useEditor((s) => s.setThemeOverride);
  const update = useEditor((s) => s.update);
  const t = resolveTheme(theme);
  const hasOverrides = Object.values(theme.overrides).some((g) => g && Object.keys(g).length);
  const reset = (group: keyof ThemeOverrides) => update((s) => { delete s.theme.overrides[group]; });
  const ResetBtn = ({ group }: { group: keyof ThemeOverrides }) => theme.overrides[group] && Object.keys(theme.overrides[group]!).length
    ? <button onClick={() => reset(group)} className="text-[11.5px] text-muted hover:text-ink flex items-center gap-1 cursor-pointer"><RotateCcw className="size-3" />Reset</button> : null;

  return (
    <div>
      <Section title="Theme presets">
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((p) => {
            const active = theme.presetId === p.id;
            const c = p.tokens.colors;
            return (
              <button key={p.id} onClick={() => setPreset(p.id, true)} aria-pressed={active} aria-label={`${p.name} theme`}
                className={cn('relative text-left rounded-lg border p-2 transition-all cursor-pointer', active ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-line hover:border-line-strong')}>
                <div className="h-14 rounded-md flex flex-col justify-center px-2.5 gap-1.5" style={{ background: c.background }}>
                  <span style={{ fontFamily: FONTS[p.tokens.typography.headingFont].stack, color: c.text, fontWeight: p.tokens.typography.headingWeight, fontSize: 14, lineHeight: 1 }}>Aa</span>
                  <span className="flex gap-1 items-center"><span className="h-2 w-8 rounded-full" style={{ background: c.buttonBackground, borderRadius: p.tokens.appearance.buttonStyle === 'pill' ? 99 : 2 }} /><span className="h-2 w-5 rounded-full" style={{ background: c.secondary }} /></span>
                </div>
                <p className="text-[12px] font-medium mt-1.5 px-0.5">{p.name}</p>
                {active && <span className="absolute top-1.5 right-1.5 size-4 rounded-full bg-brand-500 text-white grid place-items-center"><Check className="size-2.5" /></span>}
              </button>
            );
          })}
        </div>
        <p className="hint">{getPreset(theme.presetId).description}{hasOverrides ? ' Your customizations are kept when switching presets.' : ''}</p>
        {hasOverrides && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => update((s) => { s.theme.overrides = {}; })}>Reset all customizations</Button>}
      </Section>

      <Section title="Typography" aside={<ResetBtn group="typography" />}>
        <Field label="Heading font"><Select value={t.typography.headingFont} onChange={(e) => set('typography', { headingFont: e.target.value as never })}>{FONT_KEYS.map((k) => <option key={k} value={k}>{FONTS[k].label}</option>)}</Select></Field>
        <Field label="Body font"><Select value={t.typography.bodyFont} onChange={(e) => set('typography', { bodyFont: e.target.value as never })}>{FONT_KEYS.map((k) => <option key={k} value={k}>{FONTS[k].label}</option>)}</Select></Field>
        <Row label="Base size"><Slider value={t.typography.baseSize} min={12} max={22} onChange={(v) => set('typography', { baseSize: v })} unit="px" /></Row>
        <Row label="Heading scale"><Slider value={t.typography.headingScale} min={1.1} max={2} step={0.05} onChange={(v) => set('typography', { headingScale: v })} unit="×" /></Row>
        <Row label="Heading weight"><Slider value={t.typography.headingWeight} min={300} max={900} step={50} onChange={(v) => set('typography', { headingWeight: v })} /></Row>
        <Row label="Body weight"><Slider value={t.typography.bodyWeight} min={300} max={700} step={100} onChange={(v) => set('typography', { bodyWeight: v })} /></Row>
        <Row label="Line height"><Slider value={t.typography.lineHeight} min={1} max={2.2} step={0.05} onChange={(v) => set('typography', { lineHeight: v })} /></Row>
        <Row label="Letter spacing"><Slider value={t.typography.letterSpacing} min={-0.05} max={0.2} step={0.005} onChange={(v) => set('typography', { letterSpacing: v })} unit="em" /></Row>
      </Section>

      <Section title="Colors" aside={<ResetBtn group="colors" />}>
        <div className="grid grid-cols-2 gap-2">
          {([['primary', 'Primary'], ['secondary', 'Secondary'], ['background', 'Background'], ['surface', 'Card surface'], ['text', 'Text'], ['muted', 'Muted text'], ['border', 'Border'], ['inputBackground', 'Input background'], ['buttonBackground', 'Button'], ['buttonText', 'Button text']] as const).map(([k, l]) => (
            <Field key={k} label={l}><ColorField value={t.colors[k]} onChange={(v) => set('colors', { [k]: v } as never)} /></Field>
          ))}
        </div>
      </Section>

      <Section title="Layout" aside={<ResetBtn group="layout" />} defaultOpen={false}>
        <Row label="Form width"><Slider value={t.layout.formWidth} min={360} max={1200} step={10} onChange={(v) => set('layout', { formWidth: v })} unit="px" /></Row>
        <Row label="Alignment"><Segmented size="sm" value={t.layout.alignment} onChange={(v) => set('layout', { alignment: v })} items={[{ value: 'center', label: 'Center' }, { value: 'left', label: 'Left' }]} /></Row>
        <Row label="Section spacing"><Slider value={t.layout.sectionSpacing} min={8} max={96} onChange={(v) => set('layout', { sectionSpacing: v })} unit="px" /></Row>
        <Row label="Field spacing"><Slider value={t.layout.fieldSpacing} min={4} max={64} onChange={(v) => set('layout', { fieldSpacing: v })} unit="px" /></Row>
        <Row label="Container padding"><Slider value={t.layout.containerPadding} min={0} max={96} onChange={(v) => set('layout', { containerPadding: v })} unit="px" /></Row>
      </Section>

      <Section title="Appearance" aside={<ResetBtn group="appearance" />} defaultOpen={false}>
        <Row label="Corner radius"><Slider value={t.appearance.radius} min={0} max={32} onChange={(v) => set('appearance', { radius: v })} unit="px" /></Row>
        <Row label="Border width"><Slider value={t.appearance.borderWidth} min={0} max={4} onChange={(v) => set('appearance', { borderWidth: v })} unit="px" /></Row>
        <Row label="Shadow"><Segmented size="sm" value={t.appearance.shadow} onChange={(v) => set('appearance', { shadow: v })} items={[{ value: 'none', label: 'None' }, { value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]} /></Row>
        <Row label="Inputs"><Segmented size="sm" value={t.appearance.inputStyle} onChange={(v) => set('appearance', { inputStyle: v })} items={[{ value: 'outline', label: 'Outline' }, { value: 'filled', label: 'Filled' }, { value: 'underline', label: 'Line' }]} /></Row>
        <Row label="Buttons"><Segmented size="sm" value={t.appearance.buttonStyle} onChange={(v) => set('appearance', { buttonStyle: v })} items={[{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'pill', label: 'Pill' }]} /></Row>
        <Row label="Card"><Segmented size="sm" value={t.appearance.surfaceStyle} onChange={(v) => set('appearance', { surfaceStyle: v })} items={[{ value: 'card', label: 'Card' }, { value: 'flat', label: 'Flat' }]} /></Row>
        <Field label="Background pattern"><Select value={t.appearance.backgroundPattern} onChange={(e) => set('appearance', { backgroundPattern: e.target.value as never })}>{['none', 'dots', 'grid', 'lines', 'confetti'].map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}</Select></Field>
        <Field label="Background image" hint="An https:// image URL"><UrlInput value={t.appearance.backgroundImage} onCommit={(v) => set('appearance', { backgroundImage: v })} /></Field>
      </Section>
    </div>
  );
}
