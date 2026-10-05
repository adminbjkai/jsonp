import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import type { ToastState } from '../state/useToast';

/** Clicks on a message's action are ignored for this long after it appears. */
const ARM_DELAY = 500;

/** A short confirmation, with an action such as Undo when the change can be reversed. */
export default function Toast({
  toast,
  onDismiss,
  onHold,
  onRelease,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  onHold: () => void;
  onRelease: () => void;
}) {
  const armedAt = useRef(0);
  const id = toast?.id;
  useEffect(() => {
    armedAt.current = performance.now() + ARM_DELAY;
  }, [id]);
  if (!toast) return null;
  const { action } = toast;
  return (
    <div
      className="toast"
      role="status"
      key={toast.id}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      onFocus={onHold}
      onBlur={onRelease}
    >
      <Check size={15} />
      <span>{toast.message}</span>
      {action && (
        <button
          className="toast-action"
          onClick={() => {
            if (performance.now() < armedAt.current) return;
            onDismiss();
            action.run();
          }}
        >
          {action.label}
        </button>
      )}
      <button className="toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={13} />
      </button>
    </div>
  );
}
