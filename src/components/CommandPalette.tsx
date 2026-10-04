import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hint?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}
/** Every workspace action in one searchable list (Ctrl/⌘ + K). */
export default function CommandPalette({
  dialogRef,
  commands,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  commands: Command[];
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    // Available actions first, so Enter runs something useful.
    return commands
      .filter((command) => {
        const text = `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled));
  }, [commands, query]);
  const current = Math.min(index, Math.max(0, matches.length - 1));
  const currentId = matches[current]?.id;
  useEffect(() => {
    if (currentId)
      document.getElementById(`cmd-${currentId}`)?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);
  const run = (command?: Command) => {
    if (!command || command.disabled) return;
    dialogRef.current?.close();
    command.run();
  };
  return (
    <dialog
      ref={dialogRef}
      className="dialog palette-dialog"
      aria-label="Command palette"
      onClose={() => {
        setQuery('');
        setIndex(0);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <label className="palette-search">
        <Search size={17} />
        <input
          autoFocus
          aria-label="Search actions"
          placeholder="What do you want to do? Try “sort”, “csv”, “repair”…"
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={matches[current] ? `cmd-${matches[current].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setIndex((current + step + matches.length) % Math.max(1, matches.length));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(matches[current]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </label>
      <div className="palette-list" id="palette-list" role="listbox" aria-label="Actions">
        {matches.length ? (
          matches.map((command, i) => (
            <div
              key={command.id}
              id={`cmd-${command.id}`}
              role="option"
              aria-selected={i === current}
              aria-disabled={command.disabled || undefined}
              className={`palette-item ${i === current ? 'current' : ''}`}
              onPointerMove={() => i !== current && setIndex(i)}
              onClick={() => run(command)}
            >
              <span className="menu-icon">{command.icon}</span>
              <span className="palette-label">{command.label}</span>
              <small>{command.group}</small>
              {command.hint ? (
                <kbd>{command.hint}</kbd>
              ) : (
                i === current && <CornerDownLeft size={13} className="palette-enter" />
              )}
            </div>
          ))
        ) : (
          <p className="palette-empty">No matching action. Try another word.</p>
        )}
      </div>
      <div className="palette-footer">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> run
        </span>
        <span>Unavailable actions are dimmed until they apply.</span>
      </div>
    </dialog>
  );
}
