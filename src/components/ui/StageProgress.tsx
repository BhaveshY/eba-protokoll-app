import clsx from "../../lib/clsx";
import type { TranscribeStage } from "../../lib/types";

const STAGES: Array<{ id: Exclude<TranscribeStage, "done" | "error" | "cancelled">; label: string }> = [
  { id: "prepare", label: "Audio" },
  { id: "upload", label: "Upload" },
  { id: "deepgram", label: "Deepgram" },
  { id: "save", label: "Speichern" },
];

export function StageProgress({
  stage,
}: {
  stage: TranscribeStage | null;
}) {
  const activeIdx = (() => {
    if (!stage) return -1;
    if (stage === "done") return STAGES.length;
    if (stage === "error" || stage === "cancelled") return -2;
    return STAGES.findIndex((s) => s.id === stage);
  })();

  return (
    <ol className="flex items-center gap-3">
      {STAGES.map((s, i) => {
        const isDone = activeIdx > i || activeIdx === STAGES.length;
        const isActive = activeIdx === i;
        const isError = stage === "error" && i === Math.max(0, activeIdx);
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={clsx(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                isError && "bg-danger text-fg-invert",
                !isError && isDone && "bg-success text-fg-invert",
                !isError && isActive && "bg-brand text-fg-invert",
                !isError && !isDone && !isActive && "bg-bg-inset text-fg-muted"
              )}
            >
              {isDone ? "✓" : i + 1}
            </span>
            <span
              className={clsx(
                "text-xs",
                isActive ? "font-semibold text-fg" : "text-fg-muted"
              )}
            >
              {s.label}
            </span>
            {i < STAGES.length - 1 && (
              <span className="h-px w-6 bg-line" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
