import { useEffect, useRef, useState } from "react";
import { PULL_CONFIG, PULL_IDLE, pullMove, pullRelease, type PullState } from "~/lib/pull-gesture";
import { cn } from "~/lib/cn";
import { RefreshIcon } from "~/ui/icons";

/**
 * Pull down from the top of any screen to sync now.
 *
 * The sync loop already runs on its own — on load, on focus, on a slow poll — so this adds no
 * capability, only an answer: "is what I am looking at current, right now?" used to be a question
 * people answered by bouncing to another tab and back, which resyncs as a side effect of nothing
 * in particular. The gesture is the one every phone has taught for fifteen years.
 *
 * Decisions live in src/lib/pull-gesture.ts; this file owns the browser: reading `scrollY`,
 * standing down while a sheet is open, and — once a pull owns the axis — `preventDefault()` so the
 * native rubber-band does not carry the page off without us. Movement is painted straight onto the
 * elements rather than through state: a render per touchmove is the cost, and the ratchet on
 * inline styles is the reminder.
 */

/** How long the spinner shows even when the sync returns instantly — long enough to read as done. */
const MIN_SPIN_MS = 600;

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The gesture handlers live in one long-lived effect; the callback rides along in a ref so a
  // new arrow function per render does not tear the listeners down mid-touch.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let state: PullState = PULL_IDLE;
    let busy = false;
    let startX = 0;
    let startY = 0;

    const paint = (offset: number, settle: boolean) => {
      const badge = badgeRef.current;
      wrap.style.transition = settle ? "transform 200ms ease" : "none";
      wrap.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
      if (!badge) return;
      badge.style.transition = settle ? "opacity 200ms ease" : "none";
      badge.style.opacity = String(Math.min(1, offset / PULL_CONFIG.threshold));
      // The arrow winds up as the pull approaches the threshold — the affordance that says
      // "far enough" without a label.
      const icon = badge.firstElementChild as HTMLElement | null;
      if (icon) icon.style.transform = `rotate(${(offset / PULL_CONFIG.threshold) * 270}deg)`;
    };

    const finish = async () => {
      busy = true;
      setRefreshing(true);
      paint(PULL_CONFIG.threshold, true);
      try {
        // requestSync never rejects, but this component cannot know what it will be handed.
        await Promise.allSettled([
          onRefreshRef.current(),
          new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS)),
        ]);
      } finally {
        setRefreshing(false);
        busy = false;
        paint(0, true);
      }
    };

    const onStart = (event: TouchEvent) => {
      state = PULL_IDLE;
      if (busy || event.touches.length !== 1) return;
      // Only from the very top — anywhere else a downward finger means "scroll up".
      if (window.scrollY > 0) return;
      // A sheet owns its touches; a pull under the entry form would be motion behind a scrim.
      if (document.querySelector('[role="dialog"]')) return;
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      state = { phase: "pending", offset: 0 };
    };

    const onMove = (event: TouchEvent) => {
      if (state.phase === "idle" || state.phase === "abandoned") return;
      const touch = event.touches[0]!;
      state = pullMove(state, touch.clientX - startX, touch.clientY - startY, PULL_CONFIG);
      if (state.phase === "engaged") {
        if (event.cancelable) event.preventDefault();
        paint(state.offset, false);
      }
    };

    const onEnd = () => {
      const wasEngaged = state.phase === "engaged";
      const { commit } = pullRelease(state, PULL_CONFIG);
      state = PULL_IDLE;
      if (commit) void finish();
      else if (wasEngaged) paint(0, true);
    };

    wrap.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: an engaged pull calls preventDefault so the page does not rubber-band away.
    wrap.addEventListener("touchmove", onMove, { passive: false });
    wrap.addEventListener("touchend", onEnd);
    wrap.addEventListener("touchcancel", onEnd);
    return () => {
      wrap.removeEventListener("touchstart", onStart);
      wrap.removeEventListener("touchmove", onMove);
      wrap.removeEventListener("touchend", onEnd);
      wrap.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <div
        ref={badgeRef}
        role="status"
        aria-live="polite"
        aria-busy={refreshing}
        className="pointer-events-none absolute inset-x-0 -top-14 z-10 flex justify-center opacity-0"
      >
        <span
          className={cn(
            "grid size-9 place-items-center rounded-full border border-border bg-popover",
            "text-muted-foreground shadow-md",
            refreshing && "animate-spin",
          )}
        >
          <RefreshIcon size={18} />
        </span>
      </div>
      {children}
    </div>
  );
}
