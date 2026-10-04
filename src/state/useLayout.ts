import { useCallback, useEffect, useState } from 'react';
import { save, saved } from './prefs';

export type Pane = 'input' | 'output' | 'paths' | 'table' | 'graph';
export const PANE_LABELS: Record<Pane, string> = {
  input: 'Source',
  output: 'Formatted',
  paths: 'Explorer',
  table: 'Table',
  graph: 'Graph',
};
export const DEFAULT_ORDER: Pane[] = ['input', 'output', 'paths'];

function savedOrder(): Pane[] {
  const value = saved<unknown>('jsonp.order', DEFAULT_ORDER);
  return Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 5 &&
    new Set(value).size === value.length &&
    DEFAULT_ORDER.every((p) => value.includes(p)) &&
    value.every((p) => typeof p === 'string' && Object.hasOwn(PANE_LABELS, p))
    ? (value as Pane[])
    : DEFAULT_ORDER;
}

/** Which Workspace panes are open, in what order, collapsed, focused, or shown on a phone. */
export function useLayout() {
  const [order, setOrder] = useState<Pane[]>(savedOrder);
  const [collapsed, setCollapsed] = useState<Pane[]>([]);
  const [focused, setFocused] = useState<Pane | null>(null);
  const [mobilePane, setMobilePane] = useState<Pane>('input');
  useEffect(() => save('jsonp.order', order), [order]);

  const show = useCallback((pane: Pane) => {
    setOrder((prev) => (prev.includes(pane) ? prev : [...prev, pane]));
    setCollapsed((prev) => prev.filter((p) => p !== pane));
    setFocused((prev) => (prev && prev !== pane ? null : prev));
    setMobilePane(pane);
  }, []);
  /** Brings Source into view from anywhere, undoing focus and collapse. */
  const showSource = useCallback(() => {
    setMobilePane('input');
    setFocused(null);
    setCollapsed((prev) => prev.filter((pane) => pane !== 'input'));
  }, []);
  const toggle = (pane: 'graph' | 'table') => {
    if (order.includes(pane)) {
      if (focused === pane) setFocused(null);
      setOrder((prev) => prev.filter((p) => p !== pane));
      if (mobilePane === pane) setMobilePane('paths');
    } else show(pane);
  };
  const reset = () => {
    setFocused(null);
    setOrder(DEFAULT_ORDER);
    setCollapsed([]);
    setMobilePane('input');
    document.querySelectorAll<HTMLElement>('[data-pane]').forEach((el) => (el.style.flex = ''));
  };
  return {
    order,
    setOrder,
    collapsed,
    setCollapsed,
    focused,
    setFocused,
    mobilePane,
    setMobilePane,
    show,
    showSource,
    toggle,
    reset,
  };
}

export type LayoutState = ReturnType<typeof useLayout>;
