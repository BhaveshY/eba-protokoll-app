import type { UiLanguage } from "@shared/ipc";
import clsx from "../lib/clsx";
import { useT } from "../lib/i18n";
import { LanguageToggle } from "./ui/LanguageToggle";

export function Header({
  uiLanguage,
  onChangeUiLanguage,
  onOpenSettings,
}: {
  uiLanguage: UiLanguage;
  onChangeUiLanguage: (next: UiLanguage) => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const isMac =
    typeof window !== "undefined" && window.eba?.platform === "darwin";

  return (
    <header className="title-bar-drag sticky top-0 z-10 border-b border-line bg-bg-card/95 backdrop-blur-sm">
      <div
        className={clsx(
          "mx-auto flex w-full max-w-5xl items-center justify-between gap-4 py-3 pr-5 sm:pr-7",
          isMac ? "pl-[88px]" : "pl-5 sm:pl-7"
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Mark />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-fg">
              {t("app.name")}
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-fg-muted sm:block">
              {t("app.tagline")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2" data-no-drag>
          <LanguageToggle value={uiLanguage} onChange={onChangeUiLanguage} />
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-ghost !px-3"
            title={t("header.settings.title")}
            aria-label={t("header.settings")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden
              className="shrink-0"
            >
              <path
                d="M7 9.1a2.1 2.1 0 100-4.2 2.1 2.1 0 000 4.2z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M11.67 8.4a.7.7 0 00.14.77l.02.02a.85.85 0 11-1.2 1.2l-.02-.02a.7.7 0 00-.77-.14.7.7 0 00-.42.63v.06a.85.85 0 11-1.7 0v-.03a.7.7 0 00-.46-.64.7.7 0 00-.77.14l-.02.02a.85.85 0 11-1.2-1.2l.02-.02a.7.7 0 00.14-.77.7.7 0 00-.63-.42h-.06a.85.85 0 110-1.7h.03a.7.7 0 00.64-.46.7.7 0 00-.14-.77l-.02-.02a.85.85 0 111.2-1.2l.02.02a.7.7 0 00.77.14h.03a.7.7 0 00.42-.63v-.06a.85.85 0 111.7 0v.03a.7.7 0 00.42.63.7.7 0 00.77-.14l.02-.02a.85.85 0 111.2 1.2l-.02.02a.7.7 0 00-.14.77v.03a.7.7 0 00.63.42h.06a.85.85 0 110 1.7h-.03a.7.7 0 00-.63.42z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">{t("header.settings")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-fg text-fg-invert"
      aria-hidden
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M3 2h6M3 6h6M3 10h4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
