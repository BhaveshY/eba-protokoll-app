import clsx from "../../lib/clsx";

export function RecordingDot({ active }: { active: boolean }) {
  return (
    <span
      className={clsx(
        "relative inline-flex h-2.5 w-2.5 shrink-0 transition-opacity duration-150",
        active ? "opacity-100" : "opacity-0"
      )}
      aria-hidden
    >
      <span
        className={clsx(
          "absolute inset-0 rounded-full bg-danger/55",
          active && "animate-pulseRing"
        )}
      />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
    </span>
  );
}
