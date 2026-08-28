import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonVariants } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { useApp } from "~/app/AppContext";

/**
 * A destructive button that fires on *hold*, not on tap.
 *
 * Asked for by the user in exactly the right terms: accidental deletion is inevitable, so the
 * defence has to be structural. A tap does nothing but show the hint; deleting requires holding for
 * {@link HOLD_MS} while a fill visibly commits — releasing early cancels with nothing to undo. The
 * undo toast stays as the second net, but the first net is that the accident cannot happen.
 *
 * Hold-to-confirm over the alternatives, deliberately:
 * - A confirm dialog costs every *intentional* delete a second tap and a context switch, and
 *   habituation defeats it — people learn to hit "yes" without reading.
 * - A countdown-then-execute ("deleting in 3…") is the same undo toast with worse ergonomics: the
 *   deletion still happens without a deliberate act.
 * - A hold is a physically different gesture from a tap, so it cannot be performed by accident,
 *   and it costs a deliberate delete under a second.
 *
 * Keyboard users cannot hold, so Enter/Space arms a two-press confirm instead: the first press
 * swaps the label to an explicit "press again" state that disarms itself after {@link ARM_MS}.
 */

/** Long enough that a fidget cannot complete it, short enough not to feel like punishment. */
const HOLD_MS = 900;
/** How long the keyboard-armed state waits for the confirming press. */
const ARM_MS = 3000;
/** How long the "hold to delete" hint stays after a tap. */
const HINT_MS = 1600;

export function HoldButton({
  onConfirm,
  size = "sm",
  block,
  layoutClassName,
  children,
}: {
  onConfirm: () => void;
  size?: "sm" | "md";
  block?: boolean;
  /** Placement only, like Button's. */
  layoutClassName?: string;
  children: ReactNode;
}) {
  const { t } = useApp();
  const [holding, setHolding] = useState(false);
  const [state, setState] = useState<"idle" | "hinted" | "armed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  useEffect(() => () => clear(), []);

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function schedule(ms: number, run: () => void) {
    clear();
    timer.current = setTimeout(run, ms);
  }

  function down() {
    fired.current = false;
    setHolding(true);
    setState("idle");
    schedule(HOLD_MS, () => {
      fired.current = true;
      setHolding(false);
      onConfirm();
    });
  }

  function up() {
    if (fired.current) return;
    clear();
    setHolding(false);
    // A released tap teaches the gesture rather than silently ignoring the press.
    setState("hinted");
    schedule(HINT_MS, () => setState("idle"));
  }

  function cancel() {
    if (fired.current) return;
    clear();
    setHolding(false);
    setState("idle");
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.repeat) return;
    if (state === "armed") {
      clear();
      setState("idle");
      onConfirm();
      return;
    }
    setState("armed");
    schedule(ARM_MS, () => setState("idle"));
  }

  return (
    <button
      type="button"
      data-slot="hold-button"
      data-holding={holding || undefined}
      /* The fill below *is* this button's press feedback, and it has to run for the full HOLD_MS.
         A 200ms flash over the top would read as the hold having finished early. */
      data-press-flash="off"
      className={cn(
        buttonVariants({ variant: "danger", size, block: block || undefined }),
        "relative isolate touch-none select-none overflow-hidden [-webkit-touch-callout:none]",
        layoutClassName,
      )}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
      // The context menu on a long press would interrupt the hold on some platforms.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/*
        The commitment made visible: a fill that crosses the button in exactly HOLD_MS. CSS drives
        it from the data attribute, so there is no animation frame loop to leak — and `will-change`
        is unnecessary for a transform on a 40px strip.
      */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10 origin-left scale-x-0 bg-destructive/25",
          holding && "scale-x-100 transition-transform ease-linear",
        )}
        style={holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
      />
      <span aria-live="polite">
        {state === "armed"
          ? t("common.pressAgainToDelete")
          : state === "hinted"
            ? t("common.holdToDelete")
            : children}
      </span>
    </button>
  );
}
