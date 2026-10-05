import {
  Braces,
  CircleHelp,
  GitCompareArrows,
  LayoutPanelLeft,
  Lock,
  Moon,
  Search,
  Sun,
  Wand2,
} from 'lucide-react';
import { MODES, MOD, type Mode, type Theme } from '../state/prefs';

const MODE_ICONS = { format: Wand2, workspace: LayoutPanelLeft, compare: GitCompareArrows };

interface Props {
  mode: Mode;
  onMode: (mode: Mode) => void;
  theme: Theme;
  onTheme: () => void;
  onPalette: () => void;
  onHelp: () => void;
}

/** Brand, the three modes, the command palette, and the theme and help buttons. */
export default function Header({ mode, onMode, theme, onTheme, onPalette, onHelp }: Props) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="app-header">
      <h1 className="sr-only">JSON Prettify</h1>
      <a href="/" className="brand" aria-label="JSON Prettify home">
        <span className="brand-mark">
          <Braces size={17} strokeWidth={2.2} />
        </span>
        <span className="brand-name">JSON Prettify</span>
      </a>
      <nav
        className="mode-switch"
        aria-label="Mode"
        style={{ '--i': MODES.findIndex((m) => m.id === mode) } as React.CSSProperties}
      >
        <span className="mode-indicator" aria-hidden="true" />
        {MODES.map((m) => {
          const Icon = MODE_ICONS[m.id];
          return (
            <a
              key={m.id}
              href={`#${m.id}`}
              title={m.hint}
              aria-current={mode === m.id ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                onMode(m.id);
              }}
            >
              <Icon size={15} />
              <span>{m.label}</span>
            </a>
          );
        })}
      </nav>
      <button className="palette-button" aria-label="Find any action" onClick={onPalette}>
        <Search size={15} />
        <span>Find any action…</span>
        <kbd>{MOD} K</kbd>
      </button>
      <div className="header-actions">
        <span className="local-badge" title="Nothing you paste leaves this browser">
          <Lock size={13} />
          <span>On your device</span>
        </span>
        <button
          className="icon-button"
          title={`Use ${next} theme`}
          aria-label={`Use ${next} theme`}
          onClick={onTheme}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button
          className="icon-button help-button"
          title={`Help and shortcuts (${MOD} /)`}
          aria-label="Help and shortcuts"
          onClick={onHelp}
        >
          <CircleHelp size={17} />
          <span>Help</span>
        </button>
      </div>
    </header>
  );
}
