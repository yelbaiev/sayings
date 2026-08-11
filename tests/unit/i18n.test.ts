import { describe, expect, it } from "vitest";
import en from "~/i18n/en";
import ru from "~/i18n/ru";
import uk from "~/i18n/uk";
import { detectLocale, translate } from "~/i18n";
import type { PluralForms } from "~/i18n/types";

const dictionaries = { en, uk, ru } as const;

describe("dictionary completeness", () => {
  it("covers every English key in Ukrainian and Russian", () => {
    const expected = Object.keys(en).sort();
    expect(Object.keys(uk).sort()).toEqual(expected);
    expect(Object.keys(ru).sort()).toEqual(expected);
  });

  it("keeps plural messages plural in every language", () => {
    // A translation that flattened a plural message to a bare string would silently render
    // the wrong grammar for every count.
    for (const [key, value] of Object.entries(en)) {
      const isPlural = typeof value === "object";
      expect(typeof uk[key as keyof typeof uk] === "object", `uk:${key}`).toBe(isPlural);
      expect(typeof ru[key as keyof typeof ru] === "object", `ru:${key}`).toBe(isPlural);
    }
  });

  it("gives every Slavic plural message the one/few/many forms those languages need", () => {
    // uk and ru need three forms. Missing `many` would fall back to `other` and read wrong
    // for counts like 5 or 11.
    for (const [locale, dictionary] of Object.entries({ uk, ru })) {
      for (const [key, value] of Object.entries(dictionary)) {
        if (typeof value !== "object") continue;
        const forms = value as PluralForms;
        expect(forms.one, `${locale}:${key}.one`).toBeTruthy();
        expect(forms.few, `${locale}:${key}.few`).toBeTruthy();
        expect(forms.many, `${locale}:${key}.many`).toBeTruthy();
        expect(forms.other, `${locale}:${key}.other`).toBeTruthy();
      }
    }
  });

  it("leaves no untranslated English strings in uk or ru", () => {
    // Catches keys that were copied but never translated. A few legitimately match across
    // languages: the app name, Latin-script placeholders, and messages that are nothing but an
    // interpolation — `sync.lastSynced` is bare "{time}" now that the sync pill shows the
    // elapsed time alone, so there are no words in it to translate.
    const allowed = new Set(["app.name", "import.warning.noCategory", "sync.lastSynced"]);
    for (const [locale, dictionary] of Object.entries({ uk, ru })) {
      for (const [key, value] of Object.entries(dictionary)) {
        if (allowed.has(key) || typeof value !== "string") continue;
        const english = en[key as keyof typeof en];
        if (typeof english !== "string") continue;
        // Short shared tokens are fine; only flag real sentences.
        if (english.length > 4) {
          expect(value, `${locale}:${key} is still English`).not.toBe(english);
        }
      }
    }
  });
});

describe("interpolation", () => {
  it("fills placeholders", () => {
    expect(translate("en", "reports.drillDown", { category: "Groceries", period: "August" })).toBe(
      "Groceries in August",
    );
  });

  it("leaves an unknown placeholder visible rather than printing undefined", () => {
    // Uses a message with surrounding words, so the assertion tests interpolation rather than
    // just echoing a bare "{token}".
    expect(translate("en", "home.vsLastMonth", {})).toBe("vs {amount} by this day last month");
  });
});

describe("pluralisation", () => {
  it("uses English one/other", () => {
    expect(translate("en", "history.count", { count: 1 })).toBe("1 transaction");
    expect(translate("en", "history.count", { count: 5 })).toBe("5 transactions");
  });

  it("picks the right Ukrainian form for one, few, and many", () => {
    // Intl.PluralRules for uk: 1 -> one, 2-4 -> few, 5-20 -> many, 21 -> one again.
    expect(translate("uk", "history.count", { count: 1 })).toBe("1 операція");
    expect(translate("uk", "history.count", { count: 3 })).toBe("3 операції");
    expect(translate("uk", "history.count", { count: 5 })).toBe("5 операцій");
    expect(translate("uk", "history.count", { count: 11 })).toBe("11 операцій");
    expect(translate("uk", "history.count", { count: 21 })).toBe("21 операція");
  });

  it("picks the right Russian form for one, few, and many", () => {
    expect(translate("ru", "history.count", { count: 1 })).toBe("1 операция");
    expect(translate("ru", "history.count", { count: 2 })).toBe("2 операции");
    expect(translate("ru", "history.count", { count: 7 })).toBe("7 операций");
    expect(translate("ru", "history.count", { count: 101 })).toBe("101 операция");
  });

  it("does not treat 1 as singular for 21 in Slavic languages", () => {
    // The naive `count === 1 ? singular : plural` rule gets this wrong, which is exactly why
    // Intl.PluralRules is used rather than a hand-rolled check.
    for (const locale of ["uk", "ru"] as const) {
      const forms = dictionaries[locale]["history.count"] as PluralForms;
      expect(translate(locale, "history.count", { count: 21 })).toContain(
        forms.one!.replace("{count}", "21").split(" ")[1]!,
      );
    }
  });
});

describe("detectLocale", () => {
  it("matches on the base language, ignoring the region", () => {
    expect(detectLocale(["uk-UA", "en-GB"])).toBe("uk");
    expect(detectLocale(["ru-RU"])).toBe("ru");
    expect(detectLocale(["en-US"])).toBe("en");
  });

  it("skips unsupported languages and falls back to English", () => {
    expect(detectLocale(["de-DE", "pl-PL", "ru"])).toBe("ru");
    expect(detectLocale(["ja-JP"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});
