import type { RecentTranscript } from "@shared/ipc";
import { humanSize } from "../lib/transcript";
import { Card } from "./ui/Card";

export function RecentList({
  items,
  onOpen,
  onReveal,
}: {
  items: RecentTranscript[];
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  return (
    <Card title="Letzte Transkripte">
      {items.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-muted">
          Noch keine Transkripte.
        </p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {items.map((item) => (
            <li
              key={item.path}
              className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-bg-inset"
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => onOpen(item.path)}
                title={item.path}
              >
                <div className="truncate text-sm text-fg">{item.name}</div>
                <div className="text-xs text-fg-muted">
                  {new Date(item.mtime).toLocaleString("de-DE")} · {humanSize(item.size)}
                </div>
              </button>
              <button
                className="ml-3 text-xs text-brand opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:underline"
                onClick={() => onReveal(item.path)}
              >
                Im Ordner zeigen
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
