import { useEffect, useState } from "react";

/**
 * In-page messages.
 *
 * Native alert() and confirm() are blocked when the app runs inside the
 * Clawnify workspace iframe, so a message shown that way silently never
 * appears. `notify` shows it in the page instead.
 */
const EVENT = "clw:notice";

export function notify(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function Notice() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const onNotice = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, onNotice);
    return () => window.removeEventListener(EVENT, onNotice);
  }, []);
  if (!message) return null;
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="flex-1">{message}</p>
      <button onClick={() => setMessage(null)} className="text-amber-700 hover:text-amber-900" aria-label="Dismiss">×</button>
    </div>
  );
}

/** A destructive button that asks for confirmation inline before acting. */
export function ConfirmButton({
  prompt,
  confirmLabel = "Delete",
  onConfirm,
  className,
  title,
  disabled,
  children,
}: {
  prompt: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span role="group" aria-label={prompt} className="inline-flex items-center gap-2 text-xs">
        <span className="text-gray-600">{prompt}</span>
        <button onClick={() => { setAsking(false); onConfirm(); }} className="font-medium text-red-600 hover:underline">{confirmLabel}</button>
        <button onClick={() => setAsking(false)} className="text-gray-500 hover:underline">Cancel</button>
      </span>
    );
  }
  return (
    <button onClick={() => setAsking(true)} className={className} title={title} disabled={disabled}>
      {children}
    </button>
  );
}
