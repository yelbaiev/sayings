import { isLocale, type Locale } from "@shared/currency";
import en from "./en";
import ru from "./ru";
import type { Dictionary, MessageKey, PluralForms } from "./types";
import uk from "./uk";

/**
 * Translation without a dependency.
 *
 * The only genuinely hard part of i18n here is pluralisation: Ukrainian and Russian have
 * three plural forms where English has two, and the rules are not "n === 1". `Intl.PluralRules`
 * is built into the platform and gets this right, so a library buys nothing.
 *
 * Note that category and account names are *data*, shared between both household members,
 * and are never routed through here — the two users can read the UI in different languages
 * but must see one shared ledger.
 */

export type { Locale, MessageKey };

const dictionaries: Record<Locale, Dictionary> = { en: en as Dictionary, uk, ru };

/** Interpolation values. Numbers are formatted by the caller, so they arrive pre-rendered. */
export type Vars = Record<string, string | number>;

const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

function selectForm(forms: PluralForms, locale: Locale, count: number): string {
  const category = pluralRules(locale).select(count) as keyof PluralForms;
  return forms[category] ?? forms.other;
}

function interpolate(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Looks up a message and fills in its placeholders.
 *
 * When `vars.count` is present and the message has plural forms, the right form is chosen for
 * the locale. Falls back to English for a key a translation is missing, which is better than
 * rendering a blank — though `Dictionary` should make that unreachable.
 */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const message = dictionaries[locale][key] ?? (en as Dictionary)[key];

  if (typeof message === "string") {
    return interpolate(message, vars);
  }

  const count = typeof vars?.count === "number" ? vars.count : 0;
  return interpolate(selectForm(message, locale, count), vars);
}

/** Picks the best supported locale from the browser's preference list. */
export function detectLocale(
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): Locale {
  for (const tag of languages) {
    const base = tag.split("-")[0]?.toLowerCase();
    if (isLocale(base)) return base;
  }
  return "en";
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
};
