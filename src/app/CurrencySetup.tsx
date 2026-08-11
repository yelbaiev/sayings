import { type Currency } from "@shared/currency";
import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { BaseCurrencyField, EnabledCurrenciesField } from "~/features/settings/CurrencyPicker";
import { Button } from "~/ui/Button";
import { Stack } from "~/ui/layout";

/**
 * The one question a fresh installation has to answer before anything else.
 *
 * Asked here, once, rather than left as a default someone discovers later. The reporting currency is
 * denormalised onto every transaction as `base_amount_minor`, so a household that records for a month
 * and then finds the setting has a re-pricing migration ahead of it instead of a choice. Two taps now
 * or a migration later — and the migration is the kind of thing that goes wrong on someone else's
 * Cloudflare account where nobody can help them.
 *
 * Shown only when nothing has ever been recorded, so an upgrade never sees it.
 */
export function CurrencySetup({ onDone }: { onDone: () => void }) {
  const { t, baseCurrency, enabledCurrencies, saveCurrencies } = useApp();
  const [base, setBase] = useState<Currency>(baseCurrency);
  const [enabled, setEnabled] = useState<Currency[]>(enabledCurrencies);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    setSaving(true);
    setFailed(false);
    try {
      await saveCurrencies(base, enabled);
      onDone();
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl p-4">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">{t("setup.currencyTitle")}</h1>

      <div className="mb-6 rounded-lg border border-warning/60 bg-warning/10 p-4">
        <strong>{t("setup.currencyLead")}</strong>
        <p className="mt-1.5 text-xs leading-normal text-muted-foreground">{t("setup.currencyWhy")}</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <Stack gap={4}>
          <BaseCurrencyField
            value={base}
            hint={t("settings.baseCurrencyHint")}
            onChange={(next) => {
              setBase(next);
              // The base is always usable for an account, so selecting it also enables it. Otherwise
              // the first account offers a list that does not contain the household's own currency.
              setEnabled((current) =>
                current.includes(next) ? current : [...current, next].sort(),
              );
            }}
          />
          <EnabledCurrenciesField
            base={base}
            value={enabled}
            onChange={setEnabled}
            // Nothing is recorded yet, so nothing is in use and everything is free to toggle.
            locked={new Set()}
          />
          {failed && <p className="mt-1.5 text-xs leading-normal text-muted-foreground">{t("settings.currencyFailed")}</p>}
          <Button variant="primary" block disabled={saving} onClick={() => void save()}>
            {t("setup.currencyContinue")}
          </Button>
        </Stack>
      </div>
    </main>
  );
}
