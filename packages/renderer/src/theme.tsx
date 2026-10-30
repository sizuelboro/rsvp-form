import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { googleFontsHref, resolveTheme, themeToCssVars, type FormTheme, type ThemeTokens } from '@rsvp/core';

const loaded = new Set<string>();

export function useThemeFonts(tokens: ThemeTokens) {
  const href = googleFontsHref(tokens);
  useEffect(() => {
    if (!href || loaded.has(href) || typeof document === 'undefined') return;
    loaded.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }, [href]);
}

export function themeClasses(t: ThemeTokens): string {
  return [
    'fr-root',
    `fr-input-${t.appearance.inputStyle}`,
    `fr-btn-${t.appearance.buttonStyle}`,
    t.appearance.surfaceStyle === 'flat' ? 'fr-flat' : '',
    t.layout.alignment === 'left' ? 'fr-align-left' : '',
  ].filter(Boolean).join(' ');
}

/** Applies theme tokens as CSS variables to a subtree. Used by both the public page and the editor canvas. */
export function ThemeScope({ theme, children, className = '', style, fullPage = false }: { theme: FormTheme | undefined; children: ReactNode; className?: string; style?: CSSProperties; fullPage?: boolean }) {
  const tokens = useMemo(() => resolveTheme(theme), [theme]);
  useThemeFonts(tokens);
  const vars = useMemo(() => themeToCssVars(tokens), [tokens]);
  const bg = tokens.appearance.backgroundImage;
  const pattern = tokens.appearance.backgroundPattern !== 'none' ? `fr-pattern-${tokens.appearance.backgroundPattern}` : '';
  return (
    <div
      className={`${themeClasses(tokens)} ${fullPage ? `fr-page-bg ${pattern}` : ''} ${className}`}
      style={{ ...(vars as CSSProperties), ...(fullPage && bg ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--f-bg) 35%, transparent), color-mix(in srgb, var(--f-bg) 35%, transparent)), url("${encodeURI(bg)}")` } : {}), ...style }}
    >
      {children}
    </div>
  );
}
