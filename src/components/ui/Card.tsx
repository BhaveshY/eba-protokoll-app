import { ReactNode } from "react";
import clsx from "../../lib/clsx";

export interface CardProps {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Card({
  title,
  subtitle,
  right,
  children,
  className,
}: CardProps) {
  return (
    <section className={clsx("card p-5", className)}>
      {(title || subtitle || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
            )}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
