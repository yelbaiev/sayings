import type { Currency } from "@shared/currency";
import type { Minor, TxKind } from "@shared/money";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useApp } from "~/app/AppContext";
import { IconButton } from "~/ui/Button";
import { CloseIcon } from "~/ui/icons";
import {
  SWIPE_IDLE,
  swipeMove,
  swipeRelease,
  type SwipeConfig,
  type SwipeState,
} from "~/lib/swipe-gesture";
import { Slot, Toggle as TogglePrimitive } from "radix-ui";
import { cn } from "~/lib/cn";
import { Dialog, DialogContent, DialogTitle } from "~/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "~/ui/drawer";
import { Empty, EmptyContent, EmptyMedia, EmptyTitle } from "~/ui/empty";
import { Field as ShadField, FieldDescription, FieldLabel } from "~/ui/field";
import { ToggleGroup, ToggleGroupItem } from "~/ui/toggle-group";
import { formatMoney, type MoneyFormatOptions } from "~/lib/format";

/* ------------------------------------------------------------------------------ Amount */

export type AmountTone = TxKind | "neutral" | "muted";

/**
 * The one component that renders money.
 *
 * Colour is tied to direction and nothing else — red out, green in, neutral transfer — so a
 * glance down a column reads as cashflow without having to parse signs.
 */
export function Amount({
  minor,
  currency,
  tone = "neutral",
  size,
  ...options
}: {
  minor: Minor;
  currency: Currency;
  tone?: AmountTone;
  size?: "display" | "hero";
} & MoneyFormatOptions) {
  const { locale } = useApp();
  const classes = cn(
    // `sensitive`: money is what privacy mode exists to hide, and every amount renders here.
    "sensitive whitespace-nowrap font-semibold tabular-nums",
    tone === "expense" && "text-expense",
    tone === "income" && "text-income",
    tone === "transfer" && "text-transfer",
    tone === "muted" && "text-muted-foreground",
    size === "hero" && "block text-[26px] font-bold tracking-tight",
    size === "display" && "block text-[32px] font-bold tracking-tight",
  );

  return <span className={classes}>{formatMoney(minor, currency, locale, options)}</span>;
}

/* ------------------------------------------------------------------------------- chips */

/**
 * A selectable pill — Radix Toggle underneath, so `aria-pressed` and the on/off data-state come
 * from a primitive rather than from remembering to set them.
 *
 * `pressed` is pinned to the prop (controlled): a chip in this app never owns its selection, the
 * screen's state does, and Radix's uncontrolled mode would let the two drift on the first tap.
 */
/**
 * The chip recipe, exported for the one non-button chip: the date picker's `<label>` wrapping a
 * hidden `<input type=date>`, which must look identical to its Chip siblings but cannot be a Toggle.
 */
export const chipClasses = (active?: boolean) =>
  cn(
    "inline-flex min-h-11 shrink-0 select-none items-center gap-1.5 whitespace-nowrap",
    "rounded-full border border-input bg-transparent px-3.5 text-sm font-medium",
    "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    "hover:bg-accent active:bg-accent",
    "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
    "aria-disabled:cursor-default",
    active && "border-primary bg-primary text-primary-foreground",
  );

export function Chip({
  active,
  onClick,
  children,
  ...props
}: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <TogglePrimitive.Root
      pressed={!!active}
      onPressedChange={() => undefined}
      onClick={onClick}
      data-slot="chip"
      className={chipClasses()}
      {...props}
    >
      {children}
    </TogglePrimitive.Root>
  );
}

export function IconChip({
  icon,
  color,
  small,
}: {
  /** An emoji when it comes from the data, or an SVG element for chrome markers. */
  icon: ReactNode;
  color?: string | undefined;
  small?: boolean | undefined;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full leading-none",
        "bg-[color-mix(in_srgb,var(--chip-color,var(--muted-foreground))_16%,transparent)]",
        small ? "size-7 text-sm" : "size-[34px] text-[19px]",
      )}
      // Data-driven colour: the category or account chose it. The one legitimate inline style.
      // eslint-disable-next-line no-restricted-syntax -- dynamic data colour
      style={{ ["--chip-color" as string]: color }}
      aria-hidden
    >
      {icon}
    </span>
  );
}

/** Who entered a transaction. Small, but it is what stops the two of you double-logging. */
export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[var(--avatar-color,var(--muted-foreground))] text-[10px] font-bold text-white"
      // eslint-disable-next-line no-restricted-syntax -- dynamic data colour
      style={{ ["--avatar-color" as string]: color }}
      title={name}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/* --------------------------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix reports deselection as "": a segmented control always has a value, so a tap on
        // the current segment is a no-op rather than a cleared state.
        if (next) onChange(next as T);
      }}
      aria-label={label}
      data-slot-house="segmented"
      className="w-full rounded-lg bg-muted p-1"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            "flex-1 rounded-md text-sm font-medium text-muted-foreground",
            "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/* ------------------------------------------------------------------------------- sheet */

/** A live media query — read once would miss a tablet rotating across the breakpoint. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Bottom sheet on mobile, centred dialog on desktop — vaul below 900px, Radix Dialog above
 * (ADR 0006; the drag physics, focus trap, Escape and the iOS-honoured scroll lock all come from
 * the primitives now, replacing ~120 lines of hand-rolled gesture code whose pointer-capture bugs
 * took three releases to kill).
 *
 * One wrapper, one API, deliberately: the receipt viewer once grew its own dialog and every way it
 * differed — dismiss side, opacity, corners — was a defect. Every dialog in the app goes through
 * here, and a test pins that DrawerContent/DialogContent render nowhere else.
 */
export function Sheet({
  title,
  titleControl,
  fill,
  onClose,
  children,
  footer,
  actions,
  bodyClassName,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Extra controls in the header, before the dismiss.
   *
   * Here so that a dialog needing its own actions does not get rebuilt from scratch — which is what
   * happened with the receipt viewer, and produced a second dialog whose dismiss sat on the opposite
   * side, looked different, and let the page show through its header.
   */
  actions?: ReactNode;
  /**
   * Rendered in place of the title text.
   *
   * For a dialog whose subject *is* a control — the entry sheet's expense/income/transfer switch,
   * which would otherwise repeat as a heading and a segmented control one line apart. `title` is
   * still required and still names the dialog to a screen reader, so nothing is lost by not
   * drawing it.
   */
  titleControl?: ReactNode;
  /**
   * Makes the sheet take the whole screen rather than only the height its content needs — for the
   * entry form, whose keypad owns the bottom of the screen. Meaningless on desktop, where the
   * dialog is centred with room to spare, so only the drawer branch reads it.
   */
  fill?: boolean;
  /** For a body that is one object rather than a form — an image, a chart. */
  bodyClassName?: string;
}) {
  const { t } = useApp();
  const desktop = useMediaQuery("(min-width: 900px)");

  const close = (open: boolean) => {
    if (!open) onClose();
  };

  const header = (
    <div className="flex shrink-0 items-center gap-2 py-2 pl-4 pr-3">
      {/* mr-auto keeps the dismiss on the trailing edge by construction — a dialog cannot
          accidentally put its close button first. */}
      {titleControl ?? (
        <h2 className="mr-auto min-w-0 truncate text-[17px] font-bold">{title}</h2>
      )}
      {actions}
      {/* An icon, not the word: the primary action at the other end already says what the sheet
          is for. */}
      <IconButton label={t("common.close")} onClick={onClose}>
        <CloseIcon />
      </IconButton>
    </div>
  );

  const body = (
    <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-1", bodyClassName)}>
      {children}
    </div>
  );

  if (desktop) {
    return (
      <Dialog open onOpenChange={close}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[min(88dvh,760px)] w-[min(560px,calc(100vw-48px))] max-w-none flex-col gap-0 p-0"
        >
          {/* Radix requires a title for the accessible name; visually it lives in the header. */}
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {header}
          {body}
          {footer}
        </DialogContent>
      </Dialog>
    );
  }

  /*
   * repositionInputs OFF: vaul's keyboard handling shoves the whole drawer upward and leaves a
   * void beneath — the quick-tile editor flew to the top of the screen the moment its name field
   * focused. With it off the drawer stays put, the visual viewport shrinks, and the browser
   * scrolls the focused field into view inside the body, which is the behaviour a form expects.
   */
  return (
    <Drawer open onOpenChange={close} repositionInputs={false}>
      <DrawerContent
        aria-label={title}
        className={cn(
          // Bottom safe area on every drawer: the phone's rounded corners and home indicator
          // otherwise clip whatever sits flush at the bottom — the save bar's edges, reported
          // from a screenshot. On a squared display env() is zero and nothing changes.
          "pb-[env(safe-area-inset-bottom)]",
          // No top border on any sheet, at the user's call: the scrim, the rounded corners and
          // the grabber already say where the sheet begins, and the hairline only added a bright
          // stripe over dark content.
          "data-[vaul-drawer-direction=bottom]:border-t-0",
          fill &&
            // The vendored drawer carries mt-24, max-h-[80vh] and rounded-t-lg behind a
            // data-variant, and tailwind-merge only collapses conflicts within the same variant —
            // so a bare h-dvh lost to them and "full screen" stopped at 80%. Same-variant
            // overrides are the only way to win.
            cn(
              "h-dvh pt-[env(safe-area-inset-top)]",
              "data-[vaul-drawer-direction=bottom]:mt-0",
              "data-[vaul-drawer-direction=bottom]:max-h-none",
              "data-[vaul-drawer-direction=bottom]:rounded-none",
              "[&>div:first-child]:mt-2",
            ),
        )}
      >
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        {header}
        {body}
        {/*
          The footer holds the custom keypad and the save bar. `data-vaul-no-drag` because a drag
          that starts on a keypad key must type, never dismiss — the same rule the hand-rolled sheet
          enforced by refusing pointer capture on controls.
        */}
        {footer && <div data-vaul-no-drag>{footer}</div>}
      </DrawerContent>
    </Drawer>
  );
}

/* ------------------------------------------------------------------------------- toast */

export interface ToastSpec {
  message: string;
  action?: { label: string; onClick: () => void } | undefined;
  /** Milliseconds. The undo window is 5s, long enough to react without lingering. */
  duration?: number | undefined;
}

export function Toast({ spec, onDismiss }: { spec: ToastSpec; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, spec.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [spec, onDismiss]);

  return (
    <div
      className={cn(
        "fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2",
        "flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-full py-2.5 pl-4 pr-3",
        "bg-foreground text-sm text-background shadow-lg",
      )}
      role="status"
    >
      <span>{spec.message}</span>
      {spec.action && (
        <button
          type="button"
          className="rounded-full bg-background/20 px-2.5 py-1 font-bold"
          onClick={() => {
            spec.action!.onClick();
            onDismiss();
          }}
        >
          {spec.action.label}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- swipe row */

export interface SwipeAction {
  label: string;
  /** "danger" gets the expense colour; "neutral" gets the accent. */
  tone?: "danger" | "neutral";
  onAction: () => void;
}

/**
 * Swipeable row following current iOS conventions, rather than the older
 * drag-past-a-line-and-it-fires behaviour this replaces.
 *
 * Three states, which is what people now expect:
 *
 *  - **Drag and release short** — the row snaps back. Nothing happens.
 *  - **Drag past the reveal point** — the row stays open with the action button exposed, and you
 *    tap it deliberately. This is the important one: the previous version fired on release, so a
 *    slightly-too-long swipe deleted a transaction with no confirmation step.
 *  - **Drag most of the way across** — the action commits immediately, for when you know.
 *
 * Any other interaction closes it, and the action buttons are real buttons, so they are
 * reachable without the gesture at all.
 */
export function SwipeRow({
  children,
  left,
  right,
}: {
  children: ReactNode;
  /** Revealed by swiping left (button sits on the right edge). Usually destructive. */
  left?: SwipeAction | undefined;
  /** Revealed by swiping right (button sits on the left edge). */
  right?: SwipeAction | undefined;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  /*
   * The gesture state lives in a ref as well as in `offset`.
   *
   * `onPointerUp` used to read `offset` out of the render closure, which can be a frame behind the
   * last `pointermove` — so a fast swipe sometimes decided using a smaller displacement than the
   * one on screen, and did not commit. The ref is always current.
   */
  const gesture = useRef<SwipeState>(SWIPE_IDLE);
  const width = useRef(0);
  const container = useRef<HTMLDivElement>(null);

  /*
   * Built when a handler runs, not during render: the row's measured width lives in a ref, and
   * reading a ref while rendering is neither correct nor allowed by the lint rules.
   */
  const readConfig = (): SwipeConfig => ({
    width: width.current,
    /** How far the row opens to expose one button. */
    reveal: 88,
    /** Past this fraction of the row width, release commits the action outright. */
    commitFraction: 0.45,
    engageSlop: 10,
    hasLeft: Boolean(left),
    hasRight: Boolean(right),
  });

  const apply = (next: SwipeState) => {
    gesture.current = next;
    // Only re-render when the row actually moves. During a vertical scroll every pointermove
    // resolves to the same offset, and updating state on each one is a re-render per frame across
    // every visible row.
    setOffset((current) => (current === next.offset ? current : next.offset));
  };

  const close = () => apply(SWIPE_IDLE);

  const commit = (action: SwipeAction | undefined) => {
    close();
    action?.onAction();
  };

  // An open row should close when anything else on the page is touched, the same way a
  // half-open Mail row does.
  useEffect(() => {
    if (offset === 0) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // `close` is recreated every render but always does the same thing; listing it would rebind
    // this listener on every frame of a drag for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  return (
    <div ref={container} style={{ position: "relative", overflow: "hidden" }}>
      {/* Buttons sit behind the row and are revealed, rather than being coloured backdrops that
          cannot be pressed. */}
      {left && (
        <button
          type="button"
          className={cn(
            "absolute inset-y-0 right-0 grid place-items-center overflow-hidden text-[13px] font-semibold text-white",
            left.tone === "neutral" ? "bg-transfer" : "bg-expense",
          )}
          // eslint-disable-next-line no-restricted-syntax -- width driven by drag distance
          style={{ width: Math.max(0, -offset) }}
          tabIndex={offset < 0 ? 0 : -1}
          aria-hidden={offset >= 0}
          onClick={() => commit(left)}
        >
          <span className="whitespace-nowrap px-3">{left.label}</span>
        </button>
      )}

      {right && (
        <button
          type="button"
          className={cn(
            "absolute inset-y-0 left-0 grid place-items-center overflow-hidden text-[13px] font-semibold text-white",
            right.tone === "danger" ? "bg-expense" : "bg-transfer",
          )}
          // eslint-disable-next-line no-restricted-syntax -- width driven by drag distance
          style={{ width: Math.max(0, offset) }}
          tabIndex={offset > 0 ? 0 : -1}
          aria-hidden={offset <= 0}
          onClick={() => commit(right)}
        >
          <span className="whitespace-nowrap px-3">{right.label}</span>
        </button>
      )}

      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 220ms cubic-bezier(0.22,0.61,0.36,1)",
          position: "relative",
          background: "var(--card)",
          /*
           * The browser may keep the vertical axis for scrolling; the horizontal one is ours.
           * Without this it could claim the horizontal pan for overscroll or back-navigation and
           * deliver `pointercancel` in the middle of a swipe, which snapped the row shut.
           */
          touchAction: "pan-y",
        }}
        onPointerDown={(event) => {
          // Secondary mouse buttons are not swipes.
          if (event.button !== 0) return;
          width.current = event.currentTarget.offsetWidth;
          start.current = { x: event.clientX, y: event.clientY };
          gesture.current = { phase: "pending", offset: 0 };
          /*
           * Nothing else happens here. No capture, no state change.
           *
           * Capturing on press was wrong in two ways at once. It retargets `pointerup`, so `click`
           * is dispatched to this div rather than the row button inside it — which stopped
           * transactions opening at all. And a captured element keeps receiving `pointermove` while
           * the *browser* is scrolling, so the handler ran on every frame of every scroll and
           * re-rendered the row each time.
           */
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const previous = gesture.current;
          const next = swipeMove(
            previous,
            event.clientX - start.current.x,
            event.clientY - start.current.y,
            readConfig(),
          );

          if (next.phase === "engaged" && previous.phase !== "engaged") {
            /*
             * Capture now, and only now — once this is definitely a swipe rather than a tap or a
             * scroll. From here it is wanted: a horizontal drag on a 60px row leaves the row almost
             * immediately, and without capture `pointermove` stops and `pointerup` never arrives,
             * leaving the row frozen half-open.
             */
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }

          apply(next);
        }}
        onPointerUp={() => {
          start.current = null;
          setDragging(false);
          // A press that never engaged is a tap. Leave it entirely alone so the click reaches the
          // row underneath.
          if (gesture.current.phase !== "engaged") {
            gesture.current = SWIPE_IDLE;
            return;
          }
          const { offset: rest, commit: side } = swipeRelease(gesture.current, readConfig());
          if (side) {
            commit(side === "left" ? left : right);
            return;
          }
          apply({ phase: "idle", offset: rest });
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          close();
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- misc bits */

export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <Empty>
      {icon && (
        <EmptyMedia variant="default" aria-hidden className="text-4xl">
          {icon}
        </EmptyMedia>
      )}
      <EmptyTitle className="font-normal text-muted-foreground">{message}</EmptyTitle>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <ShadField data-slot-house="field">
      {/* htmlFor/id rather than wrapping: a <label> wrapper labels its first labelable child even
          when that child is a button, which is the bug FieldGroup exists to avoid. */}
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Slot.Root id={id}>{children}</Slot.Root>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </ShadField>
  );
}

/**
 * A labelled group of controls that are not a form field.
 *
 * Looks identical to `Field` and is deliberately a separate primitive, because `Field` renders a
 * `<label>` — and a `<label>` labels the first *labelable* descendant, which per the HTML spec
 * includes `<button>`. Wrapping a row of chips in one therefore hands the whole field's label to the
 * first chip as its accessible name: a screen reader announced the first currency as "Currencies you
 * use AED AUD AZN …" and every other chip as itself. Found by a test asking for a button named UAH.
 *
 * Same classes, so the two are indistinguishable on screen. Different element, so they are
 * distinguishable to everything that is not a screen.
 */
export function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <ShadField role="group" aria-labelledby={id} data-slot-house="field-group">
      <FieldLabel asChild>
        <span id={id}>{label}</span>
      </FieldLabel>
      {children}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </ShadField>
  );
}

export function Progress({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-border"
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          // Over budget is the state this component exists to show; Radix Progress clamps it away.
          ratio > 1 ? "bg-expense" : "bg-primary",
        )}
        // eslint-disable-next-line no-restricted-syntax -- dynamic measured width
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
