import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Layout primitives — now Tailwind utilities behind the same typed API.
 *
 * They exist because 67 of the app's 120 inline styles were raw spacing — `marginTop: 12`,
 * `gap: 6` — put on children because the parent could not be asked for a different gap. Off-scale
 * values crept in that way, which is the mechanism by which a spacing scale stops meaning anything.
 *
 * The typed `Gap` prop survives the migration for exactly that reason: `gap` is a scale position,
 * not a number, so an off-scale value cannot be expressed. Loose utility strings at every call site
 * would reopen the hole this closed.
 *
 * The maps below are static literal strings, not template interpolation — Tailwind's compiler reads
 * source text, and `gap-${n}` would generate nothing.
 */

/** Positions on the space scale: 4, 8, 12, 16, 24, 32px. */
export type Gap = 1 | 2 | 3 | 4 | 5 | 6;

/** The scale keeps its historical meaning: position 5 is 24px, 6 is 32px. */
const GAP: Record<Gap, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-6",
  6: "gap-8",
};

interface LayoutProps {
  gap?: Gap;
  children: ReactNode;
  /**
   * Placement of the container itself — where it sits in its own parent.
   *
   * Never appearance, and never the spacing *inside* it, which is what `gap` is for.
   */
  className?: string;
}

/** A column. The default for a group of controls or rows. */
export function Stack({ gap = 2, children, className }: LayoutProps) {
  return <div className={cn("flex flex-col", GAP[gap], className)}>{children}</div>;
}

/** A row that wraps. For chips, tags, and groups of small buttons. */
export function Cluster({ gap = 2, children, className }: LayoutProps) {
  return <div className={cn("flex flex-wrap items-center", GAP[gap], className)}>{children}</div>;
}

/**
 * A row with its ends pushed apart. Label on the left, value on the right — the shape of most rows
 * in this app.
 */
export function Spread({ gap = 3, children, className }: LayoutProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between", GAP[gap], className)}>
      {children}
    </div>
  );
}
