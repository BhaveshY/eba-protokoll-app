import clsx from "../../lib/clsx";
import { useT, type TranslationKey } from "../../lib/i18n";
import type { TranscribeStage } from "../../lib/types";

const STAGES: Array<{
  id: Exclude<TranscribeStage, "done" | "error" | "cancelled">;
  labelKey: TranslationKey;
}> = [
  { id: "prepare", labelKey: "stage.audio" },
  { id: "upload", labelKey: "stage.upload" },
  { id: "deepgram", labelKey: "stage.deepgram" },
  { id: "save", labelKey: "stage.save" },
];

export function StageProgress({ stage }: { stage: TranscribeStage | null }) {
  const t = useT();
  const activeIdx = (() => {
    if (!stage) return -1;
    if (stage === "done") return STAGES.length;
    if (stage === "error" || stage === "cancelled") return -2;
    return STAGES.findIndex((s) => s.id === stage);
  })();

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {STAGES.map((s, i) => {
        const isDone = activeIdx > i || activeIdx === STAGES.length;
        const isActive = activeIdx === i;
        const isError = stage === "error" && i === Math.max(0, activeIdx);
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={clsx(
                "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                isError && "bg-danger text-fg-invert",
                !isError && isDone && "bg-fg text-fg-invert",
                !isError && isActive && "bg-fg text-fg-invert",
                !isError &&
                  !isDone &&
                  !isActive &&
                  "border border-line text-fg-subtle"
              )}
            >
              {isDone ? "✓" : i + 1}
            </span>
            <span
              className={clsx(
                "text-[11.5px] tracking-tight",
                isActive
                  ? "font-semibold text-fg"
                  : isDone
                    ? "text-fg"
                    : "text-fg-subtle"
              )}
            >
              {t(s.labelKey)}
            </span>
            {i < STAGES.length - 1 && (
              <span className="ml-0.5 h-px w-5 bg-line" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
