import type { ReactNode } from "react";
import type { RecentTranscript } from "@shared/ipc";
import { useI18n, useT } from "../lib/i18n";
import { humanSize } from "../lib/transcript";
import { Card } from "./ui/Card";

export function RecentList({
  items,
  onOpen,
  onReveal,
}: {
  items: RecentTranscript[];
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === "en" ? "en-GB" : "de-DE";

  return (
    <Card title={t("recent.title")} flush>
      {items.length === 0 ? (
        <p className="px-5 pb-5 pt-1 text-[12px] text-fg-subtle">
          {t("recent.empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.path}
              className="border-t border-line first:border-t-0"
            >
              <button
                className="flex w-full min-w-0 items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-bg-subtle"
                onClick={() => onOpen(primaryPath(item))}
                title={primaryPath(item)}
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-card text-fg-muted">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M3 1.5h5l3 3V12a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z"
                      stroke="currentColor"
                      strokeWidth="1.1"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 1.5v3h3"
                      stroke="currentColor"
                      strokeWidth="1.1"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {displayName(item.name)}
                  </span>
                  <span className="block truncate text-[11px] text-fg-subtle">
                    {formatDate(item.mtime, locale)} · {humanSize(item.size)}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {item.readablePath && (
                      <Badge>{t("recent.hasReadable")}</Badge>
                    )}
                    {item.subtitlePath && <Badge>{t("recent.hasSubtitles")}</Badge>}
                  </span>
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
                {item.readablePath && (
                  <MiniAction onClick={() => onOpen(item.readablePath || item.path)}>
                    {t("recent.openReadable")}
                  </MiniAction>
                )}
                <MiniAction onClick={() => onOpen(item.path)}>
                  {t("recent.openOriginal")}
                </MiniAction>
                {item.subtitlePath && (
                  <MiniAction onClick={() => onOpen(item.subtitlePath || item.path)}>
                    {t("recent.openSubtitles")}
                  </MiniAction>
                )}
                <MiniAction onClick={() => onReveal(item.path)} iconOnly title={t("recent.reveal")}>
                  <FolderIcon />
                </MiniAction>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-md border border-success/20 bg-success-soft px-1.5 py-0.5 text-[10.5px] font-medium text-success">
      {children}
    </span>
  );
}

function MiniAction({
  children,
  iconOnly,
  title,
  onClick,
}: {
  children: ReactNode;
  iconOnly?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        iconOnly
          ? "inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg-card text-fg-muted transition-colors hover:bg-bg-inset hover:text-fg"
          : "inline-flex h-7 items-center justify-center rounded-md border border-line bg-bg-card px-2 text-[11px] font-medium text-fg-muted transition-colors hover:bg-bg-inset hover:text-fg"
      }
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 4.5a1 1 0 011-1h2.4a1 1 0 01.707.293l.8.8A1 1 0 007.614 5H11a1 1 0 011 1v4.5a1 1 0 01-1 1H3a1 1 0 01-1-1v-6z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function primaryPath(item: RecentTranscript): string {
  return item.readablePath || item.path;
}

function displayName(name: string): string {
  return name.replace(/\.txt$/i, "");
}

function formatDate(mtime: number, locale: string): string {
  const d = new Date(mtime);
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
