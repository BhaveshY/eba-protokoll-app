import { useMemo } from "react";
import clsx from "../lib/clsx";

export function Header({
  apiKeyPresent,
  endpoint,
  glossary,
  glossaryCount,
  onOpenSettings,
}: {
  apiKeyPresent: boolean;
  endpoint: string;
  glossary: string;
  glossaryCount: number;
  onOpenSettings: () => void;
}) {
  const host = useMemo(() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return endpoint;
    }
  }, [endpoint]);

  return (
    <header className="title-bar-drag border-b border-line bg-bg-card">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-7 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            EBA Protokoll
          </h1>
          <p className="text-xs text-fg-muted">
            Meetings aufnehmen, transkribieren und protokollieren.
          </p>
        </div>

        <div className="flex items-center gap-3" data-no-drag>
          <StatusChip
            tone={apiKeyPresent ? "success" : "warn"}
            label="API-Key"
            value={apiKeyPresent ? "gesetzt" : "fehlt"}
          />
          <StatusChip tone="muted" label="Endpoint" value={host} />
          <StatusChip
            tone="muted"
            label="Glossar"
            value={`${glossary} (${glossaryCount})`}
          />
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-ghost"
            title="Einstellungen"
          >
            Einstellungen
          </button>
        </div>
      </div>
    </header>
  );
}

function StatusChip({
  tone,
  label,
  value,
}: {
  tone: "success" | "warn" | "muted";
  label: string;
  value: string;
}) {
  return (
    <span
      className={clsx(
        "chip",
        tone === "success" && "text-success",
        tone === "warn" && "text-warn"
      )}
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          tone === "success" && "bg-success",
          tone === "warn" && "bg-warn",
          tone === "muted" && "bg-fg-muted/60"
        )}
      />
      <span className="text-fg-muted">{label}:</span>
      <span className="text-fg">{value}</span>
    </span>
  );
}
