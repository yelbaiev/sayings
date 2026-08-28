import { isCurrency, parseEnabledCurrencies, type Currency, type Locale } from "@shared/currency";
import type { Member } from "@shared/schema";
import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { db, getDevicePrefs, setDevicePrefs, type DevicePrefs } from "~/db/dexie";
import { translate, type MessageKey, type Vars } from "~/i18n";

/**
 * App-wide context: who is signed in, their language, and the theme.
 *
 * Locale lives on the member row and therefore syncs, because it is a property of the person.
 * Theme lives in device prefs and deliberately does not sync — it is a property of the phone
 * you are holding, and each device may be in a different light.
 */

export interface Me {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  /** Preferred starting account for new transactions. */
  default_account_id?: string | null | undefined;
  role: string;
  household_id: string;
  base_currency: string;
  enabled_currencies: string[];
  /** True on a fresh installation that has neither chosen its currencies nor recorded anything. */
  needs_currency_setup?: boolean;
}

export interface AppContextValue {
  me: Me;
  locale: Locale;
  /**
   * The currency every report rolls up to, read from the household rather than compiled in.
   *
   * Deliberately reached through context and not through a module-level value that setup writes
   * once. A mutable global would be the smaller diff and the worse idea in the code that decides
   * what money means: it survives between tests, and any render that happened before it was
   * assigned would price transactions in the wrong currency without failing.
   */
  baseCurrency: Currency;
  /** What an account may be denominated in. Sorted, deduplicated, and always includes the base. */
  enabledCurrencies: Currency[];
  /**
   * A second currency to repeat every total in, or null when off.
   *
   * Display only. It never reaches a stored row, which is what keeps it clear of `baseCurrency`
   * above — that one decides what money *means* here and re-prices the ledger when it changes.
   */
  secondaryCurrency: Currency | null;
  setSecondaryCurrency: (next: Currency | null) => void;
  /**
   * Saves the currency configuration and updates it here on success.
   *
   * Held in this provider rather than in the caller's own state because two screens change it and
   * every screen reads it. A local copy in Settings would leave the account editor offering the old
   * list until a reload — the setting would appear to have saved while half the app disagreed.
   *
   * Rejects on failure so the caller can say so; it deliberately does not swallow the error, because
   * this is a write that only succeeds online and pretending otherwise would be the worse outcome.
   */
  saveCurrencies: (base: Currency, enabled: Currency[]) => Promise<void>;
  t: (key: MessageKey, vars?: Vars) => string;
  theme: DevicePrefs["theme"];
  setTheme: (theme: DevicePrefs["theme"]) => void;
  setLocale: (locale: Locale) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp used outside AppProvider");
  return value;
}

/** Convenience for the common case of only needing the translator. */
export function useT(): (key: MessageKey, vars?: Vars) => string {
  return useApp().t;
}

export function AppProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const [currencies, setCurrenciesState] = useState<{ base: Currency; enabled: Currency[] }>(() => {
    // Validated rather than asserted: the value crossed a network boundary as a string, and an
    // unrecognised code must degrade to a working configuration instead of indexing into the
    // minor-unit table with undefined and turning every amount into NaN.
    const base: Currency = isCurrency(me.base_currency) ? me.base_currency : "UAH";
    return { base, enabled: parseEnabledCurrencies(me.enabled_currencies, base) };
  });

  const saveCurrencies = useCallback(async (base: Currency, enabled: Currency[]) => {
    const { setCurrencies } = await import("~/lib/api");
    const saved = await setCurrencies(base, enabled);
    // Taken from the response, not from the request: the server normalises the list, and trusting our
    // own input would let the two drift apart on the very first save.
    const confirmed: Currency = isCurrency(saved.base) ? saved.base : base;
    setCurrenciesState({
      base: confirmed,
      enabled: parseEnabledCurrencies(saved.enabled, confirmed),
    });
  }, []);

  const [theme, setThemeState] = useState<DevicePrefs["theme"]>("system");
  /* Off until the stored preference is read. A currency that flickered in on load would move every
     total on the screen a frame after it settled. */
  const [secondaryCurrency, setSecondaryState] = useState<Currency | null>(null);

  // The member row is mirrored locally, so a language change on the other device shows up
  // here without a refresh. Falls back to the value the API handed us on first load.
  const member = useLiveQuery(() => db.members.get(me.id), [me.id]);
  const locale = (member?.locale as Locale | undefined) ?? me.locale;

  useEffect(() => {
    void getDevicePrefs().then((prefs) => {
      setThemeState(prefs.theme);
      // Validated, not asserted: it crossed no network but it did cross a schema change, and an
      // unrecognised code would index the minor-unit table with undefined and render NaN.
      const stored = prefs.secondaryCurrency ?? "";
      setSecondaryState(isCurrency(stored) ? stored : null);
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setTheme = useCallback((next: DevicePrefs["theme"]) => {
    setThemeState(next);
    void setDevicePrefs({ theme: next });
  }, []);

  const setSecondaryCurrency = useCallback((next: Currency | null) => {
    setSecondaryState(next);
    void setDevicePrefs({ secondaryCurrency: next });
  }, []);

  const setLocale = useCallback(
    async (next: Locale) => {
      const { put } = await import("~/db/mutations");
      const current = await db.members.get(me.id);
      if (!current) return;
      await put<Member>("members", { ...current, locale: next }, { id: me.id });
    },
    [me.id],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      me: {
        ...me,
        ...(member
          ? {
              display_name: member.display_name,
              default_account_id: member.default_account_id ?? null,
            }
          : {}),
        locale,
      },
      locale,
      baseCurrency: currencies.base,
      enabledCurrencies: currencies.enabled,
      saveCurrencies,
      t: (key, vars) => translate(locale, key, vars),
      theme,
      setTheme,
      setLocale,
      secondaryCurrency,
      setSecondaryCurrency,
    }),
    [
      me,
      member,
      locale,
      currencies,
      saveCurrencies,
      theme,
      setTheme,
      setLocale,
      secondaryCurrency,
      setSecondaryCurrency,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
