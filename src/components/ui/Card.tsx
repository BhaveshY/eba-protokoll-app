import { ReactNode } from "react";
import clsx from "../../lib/clsx";

export interface CardProps {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Remove internal padding (for flush list layouts). */
  flush?: boolean;
}

export function Card({
  title,
  subtitle,
  right,
  children,
  className,
  flush,
}: CardProps) {
  return (
    <section className={clsx("card", !flush && "p-5", className)}>
      {(title || subtitle || right) && (
        <header
          className={clsx(
            "flex items-start justify-between gap-3",
            flush ? "px-5 pt-5 pb-3" : "mb-4"
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-xs leading-snug text-fg-muted">
                {subtitle}
              </p>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
