import {
  useEffect,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
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
  const [place, setPlace] = useState<CSSProperties | null>(null);
  // The list is positioned in window coordinates, so no scrolling or clipping ancestor can cut it
  // off. It opens below the button, or above when that side has more room, and scrolls inside
  // itself when neither side fits it. It follows the button if the page scrolls or resizes.
  const reposition = useCallback(() => {
    const box = list.current,
      anchor = button.current?.getBoundingClientRect();
    if (!box || !anchor) return;
    const margin = 8;
    const width = box.offsetWidth;
    const height = box.scrollHeight + 2;
    const below = window.innerHeight - anchor.bottom - margin - 6;
    const above = anchor.top - margin - 6;
    const up = height > below && above > below;
    const left =
      anchor.left + width > window.innerWidth - margin
        ? Math.max(margin, anchor.right - width)
        : anchor.left;
    setPlace({
      left,
      maxHeight: Math.max(96, Math.floor(up ? above : below)),
      ...(up ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
    });
  }, []);
  useLayoutEffect(() => {
    if (open) reposition();
    else setPlace(null);
  }, [open, reposition]);
  const focusItem = (index: number) => {
    const buttons = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ??
        []),
    ];
    const item = buttons.at(((index % buttons.length) + buttons.length) % buttons.length);
    if (!item) return;
    // Focus without scrolling the page (that would close the menu), then bring the item into view
    // by scrolling the menu's own list.
    item.focus({ preventScroll: true });
    const box = list.current;
    if (!box) return;
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop - 5;
    else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight + 5;
  };
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusItem(0));
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);
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
          className="menu-list"
          style={place ?? { visibility: 'hidden' }}
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
