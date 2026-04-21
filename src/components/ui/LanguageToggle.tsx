import type { UiLanguage } from "@shared/ipc";
import clsx from "../../lib/clsx";
import { SUPPORTED_LANGUAGES, useI18n } from "../../lib/i18n";

export function LanguageToggle({
  value,
  onChange,
  className,
}: {
  value: UiLanguage;
  onChange: (next: UiLanguage) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("header.language.title")}
      className={clsx(
        "inline-flex rounded-md border border-line bg-bg-card p-0.5 text-[11px] font-medium",
        className
      )}
      data-no-drag
    >
      {SUPPORTED_LANGUAGES.map((lang) => {
        const active = value === lang.value;
        return (
          <button
            key={lang.value}
            type="button"
            onClick={() => onChange(lang.value)}
            aria-pressed={active}
            className={clsx(
              "min-w-[28px] rounded px-1.5 py-0.5 transition-colors",
              active
                ? "bg-fg text-fg-invert"
                : "text-fg-muted hover:text-fg hover:bg-bg-inset"
            )}
            title={lang.labelNative}
          >
            {lang.labelShort}
          </button>
        );
      })}
    </div>
  );
}
