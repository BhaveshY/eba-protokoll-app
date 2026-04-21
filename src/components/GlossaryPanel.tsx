import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "../lib/clsx";
import { useT } from "../lib/i18n";
import { Field } from "./ui/Field";

export function GlossaryPanel({
  profiles,
  activeProfile,
  onActiveProfileChange,
  onClose,
  onRefresh,
  notify,
}: {
  profiles: string[];
  activeProfile: string;
  onActiveProfileChange: (name: string) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  notify: (kind: "info" | "success" | "warn" | "error", msg: string) => void;
}) {
  const t = useT();
  const [currentProfile, setCurrentProfile] = useState<string>(
    activeProfile || profiles[0] || "default"
  );
  const [terms, setTerms] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [newProfile, setNewProfile] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const savingRef = useRef<Promise<void> | null>(null);

  // Load terms when profile changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const loaded = await window.eba.keyterms.load(currentProfile);
        if (!cancelled) setTerms(loaded);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentProfile]);

  // If the profile list changes (create/delete), keep selection valid.
  useEffect(() => {
    if (!profiles.includes(currentProfile)) {
      setCurrentProfile(profiles[0] || "default");
    }
  }, [profiles, currentProfile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const persist = useCallback(
    async (next: string[]) => {
      const task = (async () => {
        try {
          const saved = await window.eba.keyterms.save(currentProfile, next);
          setTerms(saved);
        } catch (err) {
          notify("error", t("glossary.save.failed", { msg: (err as Error).message }));
        }
      })();
      savingRef.current = task;
      await task;
    },
    [currentProfile, notify, t]
  );

  const addTerm = useCallback(async () => {
    const v = newTerm.trim();
    if (!v) return;
    if (terms.some((x) => x.toLocaleLowerCase() === v.toLocaleLowerCase())) {
      setNewTerm("");
      return;
    }
    setNewTerm("");
    await persist([...terms, v]);
  }, [newTerm, terms, persist]);

  const removeTerm = useCallback(
    async (term: string) => {
      await persist(terms.filter((t2) => t2 !== term));
    },
    [terms, persist]
  );

  const visibleTerms = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return terms;
    return terms.filter((term) => term.toLocaleLowerCase().includes(q));
  }, [terms, query]);

  const createProfile = useCallback(async () => {
    const v = newProfile.trim();
    if (!v) return;
    try {
      await window.eba.keyterms.createProfile(v);
      setNewProfile("");
      setCreatingProfile(false);
      await onRefresh();
      setCurrentProfile(v);
      onActiveProfileChange(v);
    } catch (err) {
      notify(
        "error",
        t("glossary.profile.createFailed", { msg: (err as Error).message })
      );
    }
  }, [newProfile, onRefresh, onActiveProfileChange, notify, t]);

  const deleteProfile = useCallback(async () => {
    if (currentProfile === "default") {
      notify("warn", t("glossary.profile.protectedDefault"));
      return;
    }
    const ok = window.confirm(
      t("glossary.profile.deleteConfirm", { name: currentProfile })
    );
    if (!ok) return;
    try {
      await window.eba.keyterms.deleteProfile(currentProfile);
      await onRefresh();
      const next = profiles.filter((p) => p !== currentProfile)[0] || "default";
      setCurrentProfile(next);
      onActiveProfileChange(next);
    } catch (err) {
      notify(
        "error",
        t("glossary.profile.deleteFailed", { msg: (err as Error).message })
      );
    }
  }, [currentProfile, notify, onRefresh, profiles, onActiveProfileChange, t]);

  const handleClose = useCallback(async () => {
    if (savingRef.current) await savingRef.current;
    await onRefresh();
    onClose();
  }, [onClose, onRefresh]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-fg/25 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void handleClose();
      }}
    >
      <div
        className="flex max-h-[min(90vh,760px)] w-full max-w-xl animate-fadeInUp flex-col overflow-hidden rounded-card border border-line bg-bg-card shadow-cardHover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-fg">
              {t("glossary.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
              {t("glossary.description")}
            </p>
          </div>
          <button
            type="button"
            className="btn-quiet -mr-2 px-2"
            onClick={handleClose}
            aria-label={t("glossary.action.done")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-4 overflow-hidden px-5 py-5 sm:px-6">
          {/* Profile picker */}
          <Field label={t("glossary.profile")}>
            {creatingProfile ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="input"
                  value={newProfile}
                  onChange={(e) => setNewProfile(e.target.value)}
                  placeholder={t("glossary.profile.placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createProfile();
                    if (e.key === "Escape") {
                      setCreatingProfile(false);
                      setNewProfile("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void createProfile()}
                  disabled={!newProfile.trim()}
                >
                  {t("glossary.profile.create")}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setCreatingProfile(false);
                    setNewProfile("");
                  }}
                >
                  {t("glossary.action.cancel")}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  className="input"
                  value={currentProfile}
                  onChange={(e) => {
                    setCurrentProfile(e.target.value);
                    onActiveProfileChange(e.target.value);
                  }}
                >
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setCreatingProfile(true)}
                  title={t("glossary.profile.newLabel")}
                >
                  +
                </button>
                <button
                  type="button"
                  className="btn-ghost text-danger hover:bg-danger-soft hover:border-danger/40"
                  onClick={() => void deleteProfile()}
                  disabled={currentProfile === "default"}
                  title={t("glossary.profile.delete")}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M3 4h8M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M4 4l.5 7a.5.5 0 00.5.5h4a.5.5 0 00.5-.5L10 4"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            )}
          </Field>

          {/* Add + search */}
          <div className="grid gap-2 sm:grid-cols-[1fr,auto]">
            <div className="flex gap-2">
              <input
                className="input"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder={t("glossary.terms.addPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addTerm();
                  }
                }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => void addTerm()}
                disabled={!newTerm.trim()}
              >
                {t("glossary.terms.add")}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <input
              className="input max-w-[260px]"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("glossary.terms.search")}
            />
            <span className="text-[11.5px] text-fg-subtle">
              {t("glossary.terms.count", { count: terms.length })}
            </span>
          </div>

          {/* Terms list */}
          <div className="min-h-[160px] overflow-auto rounded-lg border border-line bg-bg-subtle p-3">
            {loading ? (
              <p className="px-1 py-6 text-center text-[12px] text-fg-subtle">
                …
              </p>
            ) : terms.length === 0 ? (
              <p className="px-1 py-6 text-center text-[12px] text-fg-subtle">
                {t("glossary.terms.empty")}
              </p>
            ) : visibleTerms.length === 0 ? (
              <p className="px-1 py-6 text-center text-[12px] text-fg-subtle">
                {t("glossary.terms.noMatches")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {visibleTerms.map((term) => (
                  <li key={term}>
                    <button
                      type="button"
                      onClick={() => void removeTerm(term)}
                      className={clsx(
                        "group inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-card px-2.5 py-1 text-[12px] text-fg transition-colors",
                        "hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                      )}
                      title={t("glossary.terms.remove")}
                    >
                      <span>{term}</span>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        aria-hidden
                        className="text-fg-subtle group-hover:text-danger"
                      >
                        <path
                          d="M2.5 2.5l5 5M7.5 2.5l-5 5"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3 sm:px-6">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleClose()}
          >
            {t("glossary.action.done")}
          </button>
        </footer>
      </div>
    </div>
  );
}
