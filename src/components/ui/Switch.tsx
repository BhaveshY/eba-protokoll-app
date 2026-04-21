import clsx from "../../lib/clsx";

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
  id?: string;
}) {
  const uid = id || label.replace(/\s+/g, "-").toLowerCase();
  return (
    <label
      htmlFor={uid}
      className={clsx(
        "flex items-start justify-between gap-4 rounded-lg border border-transparent py-2",
        disabled && "opacity-60"
      )}
    >
      <span className="min-w-0 pr-1">
        <span className="block text-[12.5px] font-medium leading-tight text-fg">
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-fg-muted">
            {hint}
          </span>
        )}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={uid}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className={clsx(
            "relative inline-flex h-[20px] w-[34px] rounded-full border border-line transition-colors duration-150",
            "bg-bg-inset peer-checked:bg-fg peer-checked:border-fg",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-fg/15",
            disabled && "cursor-not-allowed",
            !disabled && "cursor-pointer"
          )}
        >
          <span
            className={clsx(
              "absolute top-1/2 h-[14px] w-[14px] -translate-y-1/2 rounded-full bg-bg-card shadow-sm transition-transform duration-150",
              checked ? "translate-x-[16px]" : "translate-x-[2px]"
            )}
          />
        </span>
      </span>
    </label>
  );
}
