import { useCallback, useEffect, useState } from 'react';
import { DRAFT_LIMIT, initialTheme, save, saved, type Theme } from './prefs';

const THEME_COLOR: Record<Theme, string> = { dark: '#0d1119', light: '#edf0f5' };

/** Theme, the opt-in draft, line wrapping, and the first-visit banner. */
export function useSettings(input: string) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [remember, setRemember] = useState(() => saved<boolean>('jsonp.remember', false) === true);
  const [wrap, setWrap] = useState(false);
  const [welcome, setWelcome] = useState(() => !saved<boolean>('jsonp.welcomed', false));
  /** Choosing a theme is remembered; until then the system preference decides. */
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    save('jsonp.theme', next);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  }, [theme]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const follow = () => {
      if (saved<string | null>('jsonp.theme', null) === null)
        setThemeState(query.matches ? 'light' : 'dark');
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  // The draft is kept only when the person opts in, and never when it is very large.
  useEffect(() => {
    save('jsonp.remember', remember);
    if (!remember) return save('jsonp.draft', undefined);
    const timer = setTimeout(
      () => save('jsonp.draft', input.length <= DRAFT_LIMIT ? input : undefined),
      400,
    );
    return () => clearTimeout(timer);
  }, [remember, input]);
  const dismissWelcome = () => {
    setWelcome(false);
    save('jsonp.welcomed', true);
  };
  return { theme, setTheme, remember, setRemember, wrap, setWrap, welcome, dismissWelcome };
}
