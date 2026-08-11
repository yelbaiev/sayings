import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * The button: shadcn's `buttonVariants`, adapted, plus this app's thin wrappers.
 *
 * One file rather than shadcn's `button.tsx` beside a wrapper, because macOS's case-insensitive
 * filesystem cannot hold `button.tsx` and `Button.tsx` apart — the CLI's overwrite prompt during the
 * migration was that collision announcing itself.
 *
 * Adaptations from stock shadcn, each with a reason:
 *  - **`min-h-11` (44px) on every size.** shadcn's `h-9` is a desktop height; this app is used with
 *    thumbs, and the 44px floor is a tested invariant, not a preference.
 *  - **`danger` is red text on a red-tinted border — never a red fill.** A filled red button reads
 *    as either money (expense is red here) or as the screen's primary action. It is neither.
 *  - **Variant names keep this app's vocabulary** (`default`/`primary`/`ghost`/`danger`), mapped
 *    onto shadcn's appearances (outline / default / ghost / destructive-as-outline). 13 call sites
 *    and the house rule "danger never fills" survive the migration untouched.
 *  - **Hover relies on the custom `hover:` variant** (pointer: fine) from tailwind.css, so nothing
 *    here can stick on a touch screen.
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold",
    "transition-colors outline-none select-none shrink-0",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default:
          "border border-input bg-background text-foreground hover:bg-accent active:bg-accent",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        ghost: "text-foreground hover:bg-accent active:bg-accent",
        danger:
          "border border-destructive/40 text-destructive hover:bg-destructive/10 active:bg-destructive/15",
      },
      size: {
        md: "min-h-11 px-4 py-2",
        sm: "min-h-11 px-3",
        icon: "min-h-11 min-w-11 px-0",
        wide: "min-h-11 px-3",
      },
      block: {
        true: "flex w-full",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. For the bottom of a sheet, where the target should be the whole footer. */
  block?: boolean;
  /**
   * Extra classes, for placement only — margins, grid position, `margin-left: auto`.
   *
   * Deliberately not for appearance. A caller that needs a button to *look* different needs a
   * variant, and adding one here is the cheap part; the expensive part is thirty buttons that each
   * look slightly different for reasons nobody recorded.
   */
  layoutClassName?: string;
  children: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  block = false,
  layoutClassName,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block: block || undefined }), layoutClassName)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label"> {
  /** Required. An icon alone tells assistive technology nothing, and it becomes the tooltip too. */
  label: string;
  /** Square by default; `wide` suits a pair of stacked arrows in a list row. */
  shape?: "square" | "wide";
  layoutClassName?: string;
  children: ReactNode;
}

/**
 * A button whose content is an icon.
 *
 * Sized by its shape rather than its content, which is the whole point: an icon button has no label
 * to be sized by, and that is exactly why one was needed and a labelled button was borrowed instead.
 */
export function IconButton({
  label,
  shape = "square",
  layoutClassName,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      data-slot="icon-button"
      aria-label={label}
      title={label}
      className={cn(
        buttonVariants({ variant: "ghost", size: shape === "wide" ? "wide" : "icon" }),
        layoutClassName,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
