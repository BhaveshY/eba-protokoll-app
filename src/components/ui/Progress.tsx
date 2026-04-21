import clsx from "../../lib/clsx";

export function Progress({
  value,
  indeterminate,
}: {
  value?: number;
  indeterminate?: boolean;
}) {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-bg-inset">
      <div
        className={clsx(
          "h-full rounded-full bg-fg transition-[width] duration-200 ease-out",
          indeterminate && "w-1/3 animate-pulse"
        )}
        style={{
          width: indeterminate
            ? undefined
            : `${Math.max(0, Math.min(100, value ?? 0))}%`,
        }}
      />
    </div>
  );
}
