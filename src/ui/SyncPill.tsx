import { useEffect, useState } from "react";
import { useApp } from "~/app/AppContext";
import { subscribeToSync, type SyncSnapshot } from "~/db/sync-client";
import { formatRelativeTime } from "~/lib/format";
import { cn } from "~/lib/cn";

/**
 * Always-visible sync state.
 *
 * For an offline-first app holding the household's finances, the user must never have to
 * wonder whether their data made it. This is deliberately a small, non-blocking pill rather
 * than a modal or a spinner — it informs without interrupting.
 */
export function SyncPill() {
  const { t, locale } = useApp();
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  // A ticking clock rather than Date.now() in render. Besides being the pure way to do it,
  // it is what makes the label age from "just now" to "5 minutes ago" without a re-render
  // happening to come along.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeToSync(setSnapshot), []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!snapshot) return null;

  const { status, pending, lastSyncedAt } = snapshot;

  /** The dot is the message: green synced, pulsing while syncing, amber pending, red offline. */
  let dot = "bg-income";
  let label: string;

  if (status === "offline") {
    dot = "bg-expense";
    label = t("sync.offline");
  } else if (status === "syncing") {
    dot = "animate-pulse bg-transfer";
    label = t("sync.syncing");
  } else if (pending > 0) {
    dot = "bg-warning";
    label = t("sync.pending", { count: pending });
  } else if (lastSyncedAt && now - lastSyncedAt < 60_000) {
    label = t("sync.justNow");
  } else if (lastSyncedAt) {
    label = t("sync.lastSynced", { time: formatRelativeTime(lastSyncedAt, locale, now) });
  } else {
    label = t("sync.syncing");
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
      role="status"
      // The visible text is deliberately terse — the dot's colour already says "synced" — but
      // screen readers get the full sentence, where colour conveys nothing.
      aria-label={`${t("sync.synced")}: ${label}`}
    >
      <span className={cn("size-[7px] shrink-0 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}
