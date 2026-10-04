import { Check, X } from 'lucide-react';
import type { ToastState } from '../state/useToast';

/** A short confirmation, with an action such as Undo when the change can be reversed. */
export default function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  const { action } = toast;
  return (
    <div className="toast" role="status" key={toast.id}>
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
