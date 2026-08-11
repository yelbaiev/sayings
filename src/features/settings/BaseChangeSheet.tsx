import type { Currency } from "@shared/currency";
import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { changeBaseCurrency } from "~/lib/api";
import { Sheet } from "~/ui";
import { Button } from "~/ui/Button";
import { Stack } from "~/ui/layout";

/**
 * Confirming a change of reporting currency.
 *
 * A sheet rather than a select that just does it, because this is the one setting in the app that
 * rewrites data. It says what will change and — more usefully — what will not: every household that
 * keeps a ledger has reconciled its balances against real cards, and the first question anyone asks
 * about a currency change is whether those balances are about to move. They are not, and being told so
 * before pressing the button is the difference between a setting and a leap.
 *
 * The progress line is not decoration. Re-pricing runs in bounded batches so it cannot exceed the
 * Worker's CPU limit, which means a household with years of history takes several seconds and several
 * round trips. A button that simply sat there would read as broken, and the natural response — pressing
 * it again — is exactly what should not happen.
 */
export function BaseChangeSheet({
  next,
  transactionCount,
  onClose,
  onDone,
}: {
  next: Currency;
  transactionCount: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useApp();
  const [progress, setProgress] = useState<{ done: number; remaining: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const working = progress !== null && !failed;

  async function run() {
    setFailed(false);
    setProgress({ done: 0, remaining: transactionCount });
    try {
      const result = await changeBaseCurrency(next, (done, remaining) =>
        setProgress({ done, remaining }),
      );
      const skipped =
        result.skippedDates.length > 0
          ? ` ${t("settings.baseChangeSkipped", { count: result.skippedDates.length })}`
          : "";
      onDone(t("settings.baseChangeDone", { base: next }) + skipped);
    } catch {
      setProgress(null);
      setFailed(true);
    }
  }

  return (
    <Sheet title={t("settings.baseChangeTitle")} onClose={onClose}>
      <Stack gap={3}>
        <p>{t("settings.baseChangeWhat", { base: next, count: transactionCount })}</p>
        {/* The reassurance, given its own emphasis: it is the answer to the question actually being
            asked, and burying it in a paragraph would waste it. */}
        <p>
          <strong>{t("settings.baseChangeSafe")}</strong>
        </p>
        <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
          {t("settings.baseChangeBackup")} {t("settings.baseChangeManual")}
        </p>

        {failed && <p className="mt-1.5 text-xs leading-normal text-muted-foreground">{t("settings.baseChangeFailed")}</p>}

        <Button variant="primary" block disabled={working} onClick={() => void run()}>
          {working
            ? t("settings.baseChangeWorking", {
                done: progress.done,
                total: transactionCount,
              })
            : t("settings.baseChangeGo", { base: next })}
        </Button>
      </Stack>
    </Sheet>
  );
}
