import { useEffect, useState } from 'react';
import { DRAFT_LIMIT, initialTheme, save, saved, type Theme } from './prefs';

/** Theme, the opt-in draft, line wrapping, and the first-visit banner. */
export function useSettings(input: string) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [remember, setRemember] = useState(() => saved<boolean>('jsonp.remember', false) === true);
  const [wrap, setWrap] = useState(false);
  const [welcome, setWelcome] = useState(() => !saved<boolean>('jsonp.welcomed', false));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save('jsonp.theme', theme);
  }, [theme]);
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
