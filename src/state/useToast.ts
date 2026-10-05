import { useCallback, useEffect, useRef, useState } from 'react';

interface ToastAction {
  label: string;
  run: () => void;
}
export interface ToastState {
  message: string;
  action?: ToastAction;
  /** Changes with every notification, so an identical message still replays. */
  id: number;
}

/** A single transient message with an optional action such as Undo. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counter = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  const notify = useCallback((message: string, action?: ToastAction) => {
    setToast({ message, action, id: ++counter.current });
    clearTimeout(timer.current);
    // A message with an action stays long enough to be used.
    timer.current = setTimeout(() => setToast(null), action ? 7000 : 3500);
  }, []);
  /** Hovering or focusing a message keeps it; leaving starts a shorter countdown. */
  const hold = useCallback(() => clearTimeout(timer.current), []);
  const release = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, notify, dismiss, hold, release };
}
