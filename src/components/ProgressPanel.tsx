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
  return (
    <Card
      title="Fortschritt"
      right={
        isActive ? (
          <button
            type="button"
            className="btn-ghost text-danger"
            onClick={onCancel}
          >
            Abbrechen
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <StageProgress stage={tx.stage} />
        <Progress value={tx.uploadPct} />
        <p className="text-xs text-fg-muted">{tx.status}</p>
        {tx.error && (
          <p className="text-xs text-danger">{tx.error}</p>
        )}
      </div>
    </Card>
  );
}
