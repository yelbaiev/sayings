import type { ReactNode } from "react";
import { IconChip } from "~/ui";
import { cn } from "~/lib/cn";
import { ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";

/**
 * One line of the entry form: an icon, what the field is, what it currently says.
 *
 * Deliberately has no open state. An earlier version expanded in place, which gave the form two
 * heights — and the taller one did not fit above the keypad, so fields fell below the fold with
 * nothing to indicate they existed. Rows that never change height make "nothing is hidden" a property
 * of the layout instead of something to re-check on every screen size; the choosing happens in a
 * sheet (see PickerSheets.tsx).
 *
 * The label sits above the value because a form read top to bottom wants the question before the
 * answer, and because the label is the part that never changes — the eye can skip it once learnt.
 */
export function EntryRow({
  icon,
  color,
  label,
  value,
  placeholder,
  trailing,
  onClick,
}: {
  /** An emoji from the data, or a glyph for a field with no data of its own. */
  icon: ReactNode;
  color?: string | undefined;
  label: string;
  /** What the field says now. Falls back to `placeholder` when nothing is chosen. */
  value?: string | undefined;
  placeholder?: string | undefined;
  /** Anything shown at the end of the row — an amount, a currency code. */
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="entry-row"
      className={cn(ROW, "border-b-0 bg-transparent hover:bg-accent active:bg-accent")}
      onClick={onClick}
    >
      <IconChip icon={icon} color={color} />
      <span className="min-w-0 flex-1">
        {/* Label above value: the question first, and the label is the part the eye learns to skip. */}
        <span className={cn(ROW_SUB, "mt-0")}>{label}</span>
        {/* A field with nothing chosen still occupies its line, so the form does not change shape
            as it is filled in — only the emphasis does. */}
        <span className={cn(ROW_TITLE, "mt-0.5", !value && "font-normal text-muted-foreground/60")}>
          {value ?? placeholder ?? ""}
        </span>
      </span>
      {trailing}
      <span className="shrink-0 text-xl leading-none text-muted-foreground/60" aria-hidden>
        ›
      </span>
    </button>
  );
}
