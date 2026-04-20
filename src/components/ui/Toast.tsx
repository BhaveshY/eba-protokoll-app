import { useEffect } from "react";
import clsx from "../../lib/clsx";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastProps {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
}

export function Toast({ kind, message, onDismiss }: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, kind === "error" ? 8000 : 4000);
    return () => clearTimeout(id);
  }, [kind, onDismiss]);

  return (
    <div
      role="status"
      className={clsx(
        "fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border shadow-cardHover p-3.5 text-sm",
        kind === "info" && "bg-bg-card border-line text-fg",
        kind === "success" && "bg-bg-card border-success/30 text-fg",
        kind === "warn" && "bg-bg-card border-warn/30 text-fg",
        kind === "error" && "bg-bg-card border-danger/40 text-fg"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={clsx(
            "mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full",
            kind === "info" && "bg-brand",
            kind === "success" && "bg-success",
            kind === "warn" && "bg-warn",
            kind === "error" && "bg-danger"
          )}
          aria-hidden
        />
        <p className="leading-snug">{message}</p>
      </div>
    </div>
  );
}
