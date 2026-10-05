import { Check, X } from 'lucide-react';
import type { ToastState } from '../state/useToast';

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
