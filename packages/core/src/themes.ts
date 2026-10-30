import type { FontKey, FormTheme, ThemeOverrides, ThemeTokens } from './schema';

export const FONTS: Record<FontKey, { label: string; stack: string; google?: string }> = {
  inter: { label: 'Inter', stack: "'Inter', ui-sans-serif, system-ui, sans-serif", google: 'Inter:wght@300..800' },
  dm_sans: { label: 'DM Sans', stack: "'DM Sans', ui-sans-serif, system-ui, sans-serif", google: 'DM+Sans:wght@300..800' },
  manrope: { label: 'Manrope', stack: "'Manrope', ui-sans-serif, system-ui, sans-serif", google: 'Manrope:wght@300..800' },
  space_grotesk: { label: 'Space Grotesk', stack: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif", google: 'Space+Grotesk:wght@300..700' },
  poppins: { label: 'Poppins', stack: "'Poppins', ui-sans-serif, system-ui, sans-serif", google: 'Poppins:wght@300;400;500;600;700;800' },
  nunito: { label: 'Nunito', stack: "'Nunito', ui-sans-serif, system-ui, sans-serif", google: 'Nunito:wght@300..900' },
  playfair: { label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@400..900' },
  cormorant: { label: 'Cormorant Garamond', stack: "'Cormorant Garamond', Georgia, serif", google: 'Cormorant+Garamond:wght@300..700' },
  fraunces: { label: 'Fraunces', stack: "'Fraunces', Georgia, serif", google: 'Fraunces:wght@300..900' },
  lora: { label: 'Lora', stack: "'Lora', Georgia, serif", google: 'Lora:wght@400..700' },
  libre_baskerville: { label: 'Libre Baskerville', stack: "'Libre Baskerville', Georgia, serif", google: 'Libre+Baskerville:wght@400;700' },
  system: { label: 'System', stack: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif' },
};

export interface ThemePreset { id: string; name: string; description: string; tokens: ThemeTokens }

const baseTokens: ThemeTokens = {
  typography: { headingFont: 'inter', bodyFont: 'inter', baseSize: 16, headingWeight: 650, bodyWeight: 400, lineHeight: 1.55, letterSpacing: 0, headingScale: 1.75 },
  colors: {
    primary: '#5146D8', secondary: '#DDD7FA', background: '#FAF9F6', surface: '#FFFFFF', text: '#232334',
    muted: '#777786', border: '#E6E4EE', inputBackground: '#FFFFFF', buttonBackground: '#5146D8', buttonText: '#FFFFFF',
  },
  layout: { formWidth: 640, alignment: 'center', sectionSpacing: 40, fieldSpacing: 24, containerPadding: 40 },
  appearance: { radius: 10, shadow: 'sm', borderWidth: 1, inputStyle: 'outline', buttonStyle: 'solid', surfaceStyle: 'card', backgroundPattern: 'none' },
};

function preset(id: string, name: string, description: string, o: ThemeOverrides): ThemePreset {
  return { id, name, description, tokens: mergeTokens(baseTokens, o) };
}

export const THEME_PRESETS: ThemePreset[] = [
  preset('minimal', 'Minimal', 'Quiet, neutral and focused.', {}),
  preset('modern', 'Modern', 'Crisp geometry with a confident accent.', {
    typography: { headingFont: 'space_grotesk', bodyFont: 'dm_sans', headingWeight: 700 },
    colors: { primary: '#2F6BFF', buttonBackground: '#111827', background: '#F4F6FA', border: '#E3E8F0', secondary: '#DCE6FF', text: '#111827', muted: '#667085' },
    appearance: { radius: 14, shadow: 'md', inputStyle: 'filled' },
  }),
  preset('elegant', 'Elegant', 'Serif headlines on warm ivory.', {
    typography: { headingFont: 'cormorant', bodyFont: 'lora', headingWeight: 600, headingScale: 2, baseSize: 17 },
    colors: { primary: '#8A6F47', secondary: '#EFE6D8', background: '#FBF8F2', text: '#2B2620', muted: '#7D7366', border: '#E7DFD2', buttonBackground: '#2B2620', inputBackground: '#FFFDF9' },
    appearance: { radius: 2, shadow: 'none', inputStyle: 'underline', buttonStyle: 'outline' },
  }),
  preset('luxury', 'Luxury', 'Deep tones with gilded accents.', {
    typography: { headingFont: 'playfair', bodyFont: 'manrope', headingWeight: 600, letterSpacing: 0.01 },
    colors: { primary: '#C9A45C', secondary: '#3A3226', background: '#14120F', surface: '#1D1A16', text: '#F3EDE2', muted: '#A89E8D', border: '#3A342B', inputBackground: '#221F1A', buttonBackground: '#C9A45C', buttonText: '#14120F' },
    appearance: { radius: 4, shadow: 'lg', backgroundPattern: 'none' },
  }),
  preset('editorial', 'Editorial', 'Magazine-style hierarchy and contrast.', {
    typography: { headingFont: 'fraunces', bodyFont: 'inter', headingWeight: 800, headingScale: 2, letterSpacing: -0.01 },
    colors: { primary: '#D2452F', secondary: '#FBE3DD', background: '#FFFFFF', text: '#111111', muted: '#5E5E5E', border: '#111111', buttonBackground: '#111111' },
    layout: { alignment: 'left', formWidth: 720 },
    appearance: { radius: 0, shadow: 'none', surfaceStyle: 'flat', borderWidth: 1, backgroundPattern: 'lines' },
  }),
  preset('corporate', 'Corporate', 'Trustworthy, structured and clear.', {
    typography: { headingFont: 'manrope', bodyFont: 'manrope', headingWeight: 700, baseSize: 15 },
    colors: { primary: '#0F5BD8', secondary: '#E3EDFC', background: '#F3F5F8', text: '#0F1B2D', muted: '#5B6779', border: '#DCE1E8', buttonBackground: '#0F5BD8' },
    appearance: { radius: 6, shadow: 'sm', backgroundPattern: 'grid' },
  }),
  preset('playful', 'Playful', 'Rounded shapes and friendly color.', {
    typography: { headingFont: 'nunito', bodyFont: 'nunito', headingWeight: 800 },
    colors: { primary: '#F28B79', secondary: '#FFE7D6', background: '#FFF7EF', text: '#3A2A2A', muted: '#8C7270', border: '#F3DCCB', buttonBackground: '#F28B79' },
    appearance: { radius: 20, shadow: 'md', buttonStyle: 'pill', backgroundPattern: 'confetti' },
  }),
  preset('colorful', 'Colorful', 'Bold surfaces and vivid accents.', {
    typography: { headingFont: 'poppins', bodyFont: 'dm_sans', headingWeight: 700 },
    colors: { primary: '#7B3FF2', secondary: '#FFD84D', background: '#EFE9FF', text: '#1F1640', muted: '#6B6290', border: '#DCD0FF', buttonBackground: '#7B3FF2' },
    appearance: { radius: 16, shadow: 'lg', buttonStyle: 'pill', backgroundPattern: 'dots' },
  }),
  preset('classic', 'Classic', 'Timeless serif typography.', {
    typography: { headingFont: 'libre_baskerville', bodyFont: 'libre_baskerville', headingWeight: 700, baseSize: 15, lineHeight: 1.65 },
    colors: { primary: '#1F3A5F', secondary: '#E4E9F0', background: '#F7F5F0', text: '#1E1E1E', muted: '#6A6A6A', border: '#D9D4C7', buttonBackground: '#1F3A5F' },
    appearance: { radius: 4, shadow: 'sm' },
  }),
  preset('romantic', 'Romantic', 'Soft blush tones for celebrations.', {
    typography: { headingFont: 'cormorant', bodyFont: 'dm_sans', headingWeight: 500, headingScale: 2, letterSpacing: 0.01 },
    colors: { primary: '#B56576', secondary: '#F6E1E5', background: '#FDF5F3', text: '#3D2C2E', muted: '#8E7376', border: '#F0DADB', buttonBackground: '#B56576', inputBackground: '#FFFCFB' },
    appearance: { radius: 12, shadow: 'sm', buttonStyle: 'pill' },
  }),
];

export function getPreset(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0]!;
}

export function mergeTokens(base: ThemeTokens, o: ThemeOverrides | undefined): ThemeTokens {
  if (!o) return base;
  const strip = <T extends object>(x: T | undefined) =>
    Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
  return {
    typography: { ...base.typography, ...strip(o.typography) },
    colors: { ...base.colors, ...strip(o.colors) },
    layout: { ...base.layout, ...strip(o.layout) },
    appearance: { ...base.appearance, ...strip(o.appearance) },
  };
}

/** Preset tokens + form-level overrides. Element-level style overrides are applied separately by the renderer. */
export function resolveTheme(theme: FormTheme | undefined): ThemeTokens {
  return mergeTokens(getPreset(theme?.presetId ?? 'minimal').tokens, theme?.overrides);
}

const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px rgba(20,20,40,.04), 0 1px 3px rgba(20,20,40,.06)',
  md: '0 4px 12px rgba(20,20,40,.06), 0 1px 3px rgba(20,20,40,.05)',
  lg: '0 18px 40px rgba(20,20,40,.10), 0 2px 6px rgba(20,20,40,.05)',
} as const;

/** CSS custom properties consumed by the renderer stylesheet. */
export function themeToCssVars(t: ThemeTokens): Record<string, string> {
  return {
    '--f-heading-font': FONTS[t.typography.headingFont].stack,
    '--f-body-font': FONTS[t.typography.bodyFont].stack,
    '--f-base-size': `${t.typography.baseSize}px`,
    '--f-heading-weight': String(t.typography.headingWeight),
    '--f-body-weight': String(t.typography.bodyWeight),
    '--f-line-height': String(t.typography.lineHeight),
    '--f-letter-spacing': `${t.typography.letterSpacing}em`,
    '--f-heading-scale': String(t.typography.headingScale),
    '--f-primary': t.colors.primary,
    '--f-secondary': t.colors.secondary,
    '--f-bg': t.colors.background,
    '--f-surface': t.colors.surface,
    '--f-text': t.colors.text,
    '--f-muted': t.colors.muted,
    '--f-border': t.colors.border,
    '--f-input-bg': t.colors.inputBackground,
    '--f-button-bg': t.colors.buttonBackground,
    '--f-button-text': t.colors.buttonText,
    '--f-form-width': `${t.layout.formWidth}px`,
    '--f-section-gap': `${t.layout.sectionSpacing}px`,
    '--f-field-gap': `${t.layout.fieldSpacing}px`,
    '--f-pad': `${t.layout.containerPadding}px`,
    '--f-radius': `${t.appearance.radius}px`,
    '--f-shadow': SHADOWS[t.appearance.shadow],
    '--f-border-width': `${t.appearance.borderWidth}px`,
  };
}

export function googleFontsHref(t: ThemeTokens): string | null {
  const families = [...new Set([t.typography.headingFont, t.typography.bodyFont])]
    .map((k) => FONTS[k].google)
    .filter(Boolean);
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;
}
