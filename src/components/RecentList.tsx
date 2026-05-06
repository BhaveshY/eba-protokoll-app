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
              className="group relative border-t border-line first:border-t-0"
            >
              <button
                className="flex w-full min-w-0 items-center gap-3 px-5 py-3.5 pr-16 text-left transition-colors hover:bg-bg-subtle"
                onClick={() => onOpen(item.path)}
                title={item.path}
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
                    {item.name}
                  </span>
                  <span className="block text-[11px] text-fg-subtle">
                    {formatDate(item.mtime, locale)} · {humanSize(item.size)}
                    {item.subtitlePath ? ` · ${t("recent.hasSubtitles")}` : ""}
                  </span>
                </span>
                <span className="hidden rounded-md border border-success/20 bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success sm:inline-flex">
                  {t("recent.ready")}
                </span>
              </button>
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle opacity-0 transition-all hover:bg-bg-inset hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onReveal(item.path);
                }}
                title={t("recent.reveal")}
                aria-label={t("recent.reveal")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M2 4.5a1 1 0 011-1h2.4a1 1 0 01.707.293l.8.8A1 1 0 007.614 5H11a1 1 0 011 1v4.5a1 1 0 01-1 1H3a1 1 0 01-1-1v-6z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
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
