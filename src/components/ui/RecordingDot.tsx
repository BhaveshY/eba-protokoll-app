import clsx from "../../lib/clsx";

export function RecordingDot({ active }: { active: boolean }) {
  return (
    <span
      className={clsx(
        "relative inline-flex h-3 w-3 shrink-0",
        active ? "" : "opacity-0"
      )}
      aria-hidden
    >
      <span
        className={clsx(
          "absolute inset-0 rounded-full bg-danger/70",
          active && "animate-pulseRing"
        )}
      />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
    </span>
  );
}
