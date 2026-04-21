import { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint && (
        <span className="text-[11px] leading-snug text-fg-subtle">{hint}</span>
      )}
    </label>
  );
}
