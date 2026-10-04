import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  separator?: boolean;
  run: () => void;
}
/** Accessible dropdown menu: click or Enter/Space/↓ opens it; arrow keys move; Escape closes. */
export default function Menu({
  label,
  icon,
  items,
  className = '',
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  // Keep the menu inside the viewport: open rightward unless that would overflow.
  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return;
    const anchor = button.current.getBoundingClientRect();
    setAlignRight(anchor.left + list.current.offsetWidth > window.innerWidth - 8);
  }, [open]);
  const focusItem = (index: number) => {
    const buttons = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ??
        []),
    ];
    buttons.at(((index % buttons.length) + buttons.length) % buttons.length)?.focus();
  };
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusItem(0));
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={root}>
      <button
        ref={button}
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon} {label} <ChevronDown size={13} className="menu-caret" />
      </button>
      {open && (
        <div
          ref={list}
          className={`menu-list ${alignRight ? 'align-right' : ''}`}
          role="menu"
          id={id}
          aria-label={label}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role=menuitem]:not(:disabled)',
              ),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              focusItem(index + (event.key === 'ArrowDown' ? 1 : -1));
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              focusItem(event.key === 'Home' ? 0 : -1);
            } else if (event.key === 'Escape' || event.key === 'Tab') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {items.map((item) => (
            <div key={item.label} className={item.separator ? 'menu-separator' : undefined}>
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  item.run();
                }}
              >
                <span className="menu-icon">{item.icon}</span>
                <span className="menu-label">{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
