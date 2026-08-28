import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useApp } from "~/app/AppContext";
import { cn } from "~/lib/cn";
import {
  addDaysIso,
  addMonths,
  dayOfMonth,
  formatDate,
  formatDateShort,
  formatMonth,
  monthOf,
} from "~/lib/format";
import { chipClasses, useMediaQuery } from "~/ui";

/**
 * The "pick a date" chip, and what opens when it is tapped.
 *
 * Two different things, on purpose.
 *
 * **On a phone it stays the native date input.** The iOS wheel is better than anything worth
 * building here — it is what the thumb already knows, it reads the system locale and it is one
 * gesture from a date three months back.
 *
 * **On a desktop it is a calendar of our own.** The same hidden `<input type="date">` there gives
 * whatever the browser feels like: a light popup over a dark app, a different layout in every
 * browser, positioned wherever the browser chooses — and in Safari, where the picker hangs off the
 * calendar icon we deliberately hid, often nothing at all. That is what this replaces.
 */
export function DateChip({
  value,
  max,
  onChange,
  pickLabel,
}: {
  /** ISO date, `YYYY-MM-DD`. */
  value: string;
  /** The latest selectable date. A transaction cannot happen tomorrow. */
  max: string;
  onChange: (iso: string) => void;
  /** What the chip says when the date is one of the quick choices rather than a picked one. */
  pickLabel: string;
}) {
  const { locale } = useApp();
  const picked = value !== max && monthOf(value) !== "";
  const coarse = useMediaQuery("(pointer: coarse)");
  const label = picked ? formatDateShort(value, locale) : pickLabel;

  if (coarse) {
    return (
      <label className={cn(chipClasses(picked), "relative")}>
        {label}
        <input
          type="date"
          value={value}
          max={max}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          className="date-native"
          aria-label={pickLabel}
        />
      </label>
    );
  }

  return <CalendarChip value={value} max={max} onChange={onChange} label={label} picked={picked} />;
}

function CalendarChip({
  value,
  max,
  onChange,
  label,
  picked,
}: {
  value: string;
  max: string;
  onChange: (iso: string) => void;
  label: string;
  picked: boolean;
}) {
  const { locale } = useApp();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value));
  /** The day arrow keys are on. Separate from the selection: moving is not choosing. */
  const [cursor, setCursor] = useState(value);

  return (
    <Popover.Root
      open={open}
      /* Reopening on a different transaction has to land on that transaction's month rather than
         the last one browsed. Done here because opening is an event — the same work in an effect
         is a second render chasing the first. */
      onOpenChange={(next) => {
        if (next) {
          setMonth(monthOf(value));
          setCursor(value);
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger className={chipClasses(picked)}>{label}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            /* Above the sheet, not merely level with it. The dialog and the drawer are both z-50
               and this portals to the body after them, so equal z-index happens to work today and
               would stop working the first time mount order changed. The toast sits at 60 for the
               same reason. */
            "z-[60] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg",
            "outline-none",
          )}
        >
          <Calendar
            month={month}
            onMonth={setMonth}
            value={value}
            cursor={cursor}
            onCursor={setCursor}
            max={max}
            locale={locale}
            onPick={(iso) => {
              onChange(iso);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The first day of the week the locale uses, 0=Sunday.
 *
 * `Intl` knows this — Monday in Ukraine and Russia, Sunday in the United States — and asking is
 * better than a table that would need maintaining. Where the browser does not implement it the
 * fallback is Monday, which is right for every locale this app ships and for most of Europe.
 */
function firstWeekday(locale: string): number {
  const info = (
    new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } }
  ).getWeekInfo?.();
  // getWeekInfo counts 1=Monday..7=Sunday; JS getDay counts 0=Sunday.
  return info ? info.firstDay % 7 : 1;
}

function weekdayNames(locale: string): string[] {
  const first = firstWeekday(locale);
  const format = new Intl.DateTimeFormat(locale, { weekday: "short" });
  // Any week will do; 2024-01-07 was a Sunday, so day 0 of a known week.
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(2024, 0, 7 + ((first + index) % 7))),
  );
}

/** Every cell of the month's grid, padded out to whole weeks. */
function monthGrid(month: string, locale: string): string[] {
  const first = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const weekdayOfFirst = new Date(year, monthNumber - 1, 1).getDay();
  const lead = (weekdayOfFirst - firstWeekday(locale) + 7) % 7;

  const start = addDaysIso(first, -lead);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  // Whole weeks, so the grid never reflows between a five-week month and a six-week one.
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => addDaysIso(start, index));
}

function Calendar({
  month,
  onMonth,
  value,
  cursor,
  onCursor,
  max,
  locale,
  onPick,
}: {
  month: string;
  onMonth: (month: string) => void;
  value: string;
  cursor: string;
  onCursor: (iso: string) => void;
  max: string;
  locale: Parameters<typeof formatMonth>[1];
  onPick: (iso: string) => void;
}) {
  const days = monthGrid(month, locale);
  const focused = useRef<HTMLButtonElement | null>(null);

  // Arrow keys move focus, not just state — otherwise the ring stays behind while the cursor walks.
  useEffect(() => {
    focused.current?.focus();
  }, [cursor]);

  const move = (days: number) => {
    const next = addDaysIso(cursor, days);
    if (next > max) return;
    onCursor(next);
    if (monthOf(next) !== month) onMonth(monthOf(next));
  };

  return (
    <div
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowRight" ? 1
          : event.key === "ArrowLeft" ? -1
          : event.key === "ArrowDown" ? 7
          : event.key === "ArrowUp" ? -7
          : 0;
        if (step === 0) return;
        event.preventDefault();
        move(step);
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"
          onClick={() => onMonth(addMonths(month, -1))}
          aria-label={formatMonth(addMonths(month, -1), locale)}
        >
          ‹
        </button>
        <span className="text-sm font-medium">{formatMonth(month, locale)}</span>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30"
          // A month entirely in the future has nothing to offer.
          disabled={`${addMonths(month, 1)}-01` > max}
          onClick={() => onMonth(addMonths(month, 1))}
          aria-label={formatMonth(addMonths(month, 1), locale)}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {weekdayNames(locale).map((name) => (
          <span key={name} className="grid h-7 place-items-center text-[11px] text-muted-foreground">
            {name}
          </span>
        ))}

        {days.map((iso) => {
          const outside = monthOf(iso) !== month;
          const disabled = iso > max;
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              ref={iso === cursor ? focused : undefined}
              // Roving tabindex: one stop for the whole grid, then arrows. Forty-two tab stops is
              // not a date picker, it is an obstacle course.
              tabIndex={iso === cursor ? 0 : -1}
              disabled={disabled}
              className={cn(
                "grid size-9 place-items-center rounded-md text-sm tabular-nums",
                "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none",
                outside && "text-muted-foreground/50",
                disabled && "pointer-events-none opacity-30",
                selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                !selected && iso === max && "font-semibold text-primary",
              )}
              onClick={() => onPick(iso)}
              aria-current={iso === max ? "date" : undefined}
              aria-pressed={selected}
              /*
               * The whole date, not the number on the face of it. A grid holding the tail of one
               * month and the head of the next has two cells reading "29", which is ambiguous to
               * anyone listening rather than looking — and was ambiguous to the tests too, which is
               * how it was found.
               */
              aria-label={formatDate(iso, locale)}
            >
              {dayOfMonth(iso)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
