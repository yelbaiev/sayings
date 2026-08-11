import type en from "./en";

/**
 * A message is either a plain string or a set of plural forms keyed by the CLDR categories
 * that `Intl.PluralRules` returns. `other` is always required as the fallback; `one`, `few`,
 * and `many` are supplied by whichever languages need them.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | PluralForms;

/** Every key in the app, derived from the English dictionary. */
export type MessageKey = keyof typeof en;

/**
 * Other languages are typed against this, so a missing or misspelled key is a compile error
 * rather than a blank string in production. Plural-form keys stay plural-form keys — a
 * language cannot accidentally flatten one to a bare string.
 */
export type Dictionary = {
  [K in MessageKey]: (typeof en)[K] extends string ? string : PluralForms;
};
