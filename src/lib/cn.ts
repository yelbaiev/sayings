import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class combiner every shadcn component uses.
 *
 * `clsx` handles the conditional shapes (`{ "is-open": open }`, arrays, undefined); `twMerge`
 * resolves conflicts by Tailwind's rules, so a caller's `p-2` actually beats a component's `p-4`
 * instead of tying and losing to source order. Without the merge, customising a vendored component
 * from a call site is a coin flip.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
