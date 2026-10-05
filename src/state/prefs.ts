import { EXAMPLE } from '../lib/json';

/** Device-local preferences. Everything here is optional: private browsing simply forgets it. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferences are optional in private browsing. */
  }
}

export type Theme = 'dark' | 'light';

/** The theme the person chose, if any. Anything else counts as no choice. */
export function storedTheme(): Theme | null {
  const stored = saved<unknown>('jsonp.theme', null);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

/** The saved theme, or the operating system's preference until one is chosen. */
export function initialTheme(): Theme {
  return (
    storedTheme() ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
}

export type Mode = 'format' | 'workspace' | 'compare';
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'format', label: 'Format', hint: 'Paste, format, validate, and convert' },
  { id: 'workspace', label: 'Workspace', hint: 'Explore paths, tables, and graphs side by side' },
  { id: 'compare', label: 'Compare', hint: 'See two documents side by side' },
];

export const modeFromHash = (): Mode | null => {
  const hash = location.hash.slice(1);
  return MODES.some((m) => m.id === hash) ? (hash as Mode) : null;
};

export function initialMode(): Mode {
  const stored = saved<unknown>('jsonp.mode', 'format');
  return modeFromHash() ?? (MODES.some((m) => m.id === stored) ? (stored as Mode) : 'format');
}

export const DRAFT_LIMIT = 2 * 1024 * 1024;

/** The saved draft when the person opted in to keeping one, otherwise the sample. */
export function initialDraft(): string {
  const draft =
    saved<boolean>('jsonp.remember', false) === true ? saved<unknown>('jsonp.draft', null) : null;
  return typeof draft === 'string' ? draft : EXAMPLE;
}
