import { useEffect } from "react";
import clsx from "../../lib/clsx";
import { useT } from "../../lib/i18n";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastProps {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
}

export function Toast({ kind, message, onDismiss }: ToastProps) {
  const t = useT();
  useEffect(() => {
    const id = setTimeout(onDismiss, kind === "error" ? 8000 : 4000);
    return () => clearTimeout(id);
  }, [kind, onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-5 right-5 z-50 flex max-w-sm animate-fadeInUp items-stretch overflow-hidden rounded-lg border border-line bg-bg-card text-sm shadow-cardHover"
    >
      <span
        className={clsx(
          "w-[3px] shrink-0",
          kind === "info" && "bg-fg",
          kind === "success" && "bg-success",
          kind === "warn" && "bg-warn",
          kind === "error" && "bg-danger"
        )}
        aria-hidden
      />
      <div className="flex min-w-0 items-start gap-3 px-3.5 py-3">
        <p className="min-w-0 break-words leading-snug text-fg">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 shrink-0 rounded p-1 text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg"
          aria-label={t("toast.close")}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
