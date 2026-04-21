import { useT } from "../lib/i18n";
import { Card } from "./ui/Card";
import { Progress } from "./ui/Progress";
import { StageProgress } from "./ui/StageProgress";
import type { TranscriptionState } from "../state/useTranscription";

export function ProgressPanel({
  tx,
  isActive,
  onCancel,
}: {
  tx: TranscriptionState;
  isActive: boolean;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Card
      title={t("progress.title")}
      right={
        isActive ? (
          <button
            type="button"
            className="btn-quiet text-[12px] text-danger hover:text-danger hover:bg-danger-soft"
            onClick={onCancel}
          >
            {t("progress.cancel")}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <StageProgress stage={tx.stage} />
        <Progress value={tx.uploadPct} />
        <p className="min-h-[1em] text-[12px] leading-snug text-fg-muted">
          {tx.status || (isActive ? t("progress.working") : t("progress.ready"))}
        </p>
        {tx.error && (
          <p className="text-[12px] leading-snug text-danger">{tx.error}</p>
        )}
      </div>
    </Card>
  );
}
