import { type Currency } from "@shared/currency";
import type { TxKind } from "@shared/money";
import { serialiseTemplate, type QuickTileTemplate } from "@shared/quick-tile";
import type { Transaction } from "@shared/schema";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { getDevicePrefs, setDevicePrefs, type DevicePrefs } from "~/db/dexie";
import { newId, put, putMany, remove } from "~/db/mutations";
import { useAccounts, useCategories, useMembers, useTransactions } from "~/db/queries";
import {
  EMPTY_EXPRESSION,
  evaluate,
  formatExpression,
  fromMinor,
  isEmpty,
  pressBackspace,
  pressDecimal,
  pressDigit,
  pressEquals,
  pressOperator,
  type Expression,
  type Operator,
} from "~/lib/calc";
import { AmountField } from "./AmountField";
import { nextOccurrence } from "~/lib/recurring";
import { Button } from "~/ui/Button";
import { rateFor } from "~/lib/fx";
import { addDaysIso, formatMoney, todayIso } from "~/lib/format";
import { findLikelyDuplicate, resolveAccountId } from "~/lib/predict";
import { Amount, Chip, Sheet, type ToastSpec } from "~/ui";
import { cn } from "~/lib/cn";
import { HoldButton } from "~/ui/HoldButton";
import { CARD } from "~/ui/recipes";
import { Keypad } from "./Keypad";
import { EntryRow } from "./EntryRow";
import { AccountSheet, CategorySheet } from "./PickerSheets";
import { RateField, formatRate } from "./RateField";
import { DateChip } from "./DateChip";
import { ReceiptField } from "./ReceiptField";
import { SplitSheet } from "./SplitSheet";

/**
 * The amount-first entry sheet.
 *
 * The order is deliberate: the amount is what must not be got wrong and is freshest in
 * memory at the till, while the category and account can usually be predicted. In the common
 * case that makes an entry "type the number, tap a tile, tap save" — around three seconds,
 * with no typing beyond the amount.
 *
 * The save is optimistic and never awaits the network. See src/db/mutations.ts.
 */

/* Seven, not six: the grid is four columns and the "All" button occupies a cell, so six left a
   single empty slot in the second row. Seven fills both rows exactly. */

export function EntrySheet({
  editing,
  initialKind,
  contextAccountId,
  onClose,
  onSaved,
}: {
  editing?: Transaction | undefined;
  /** Preselects the kind, for the e/i/t keyboard shortcuts. Ignored when editing. */
  initialKind?: TxKind | undefined;
  /** The account whose transactions are being viewed, if any — see resolveAccountId. */
  contextAccountId?: string | null | undefined;
  onClose: () => void;
  onSaved: (toast?: ToastSpec) => void;
}) {
  const { t, me, locale, baseCurrency } = useApp();
  const accounts = useAccounts();
  const allCategories = useCategories();
  const members = useMembers();
  const transactions = useTransactions();

  const [kind, setKind] = useState<TxKind>(editing?.kind ?? initialKind ?? "expense");
  // Seeded from the row being edited. Previously this always started empty, so opening an
  // existing transaction showed 0 while its category and account were correctly preselected —
  // and saving would have overwritten a real amount with whatever was retyped.
  const [expression, setExpression] = useState<Expression>(() =>
    editing ? fromMinor(editing.amount_minor, editing.currency as Currency) : EMPTY_EXPRESSION,
  );
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [accountOverride, setAccountOverride] = useState<string | null>(
    editing?.account_id ?? null,
  );
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.to_account_id ?? null);
  /* The destination leg of a cross-currency transfer, in its own account's minor units. */
  const [toAmountMinor, setToAmountMinor] = useState<number | null>(
    editing?.to_amount_minor ?? null,
  );
  const [occurredOn, setOccurredOn] = useState(editing?.occurred_on ?? todayIso());
  const [note, setNote] = useState(editing?.note ?? "");
  const [receiptKey, setReceiptKey] = useState<string | null>(editing?.receipt_key ?? null);
  /**
   * Closed until the amount field is tapped.
   *
   * The keypad occupies the bottom third of the sheet, so leaving it up hides the date, category
   * and note fields and makes the form look like it only has one input. One extra tap on the
   * amount buys a form you can actually see.
   */
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  /**
   * Which picker is open, if any.
   *
   * A picker is a sheet over the form rather than an expansion inside it, so this changes what is on
   * top of the screen and never what the form beneath it measures. That is the property the layout
   * depends on: with the form's height fixed, the keypad below it cannot push a field out of view.
   */
  const [picker, setPicker] = useState<null | "account" | "to" | "category">(null);
  const [prefs, setPrefs] = useState<DevicePrefs | null>(null);
  /**
   * The rate from our sources, and the rate as typed. Both tagged with what they are a rate *for*.
   *
   * The tag is the point. A rate is only meaningful for one currency on one date, and all three of
   * those move while the sheet is open — switching to a euro card, then to a dollar one, then changing
   * the date. Untagged, the previous answer stays in state looking current: a euro rate applied to a
   * dollar amount is not an error, it is a number 7% wrong that nothing questions.
   *
   * Tagging also removes the need to clear either one in an effect, which is where the cascading
   * render would have come from.
   */
  const [sourceRate, setSourceRate] = useState<{
    for: string;
    rate: number;
    estimated: boolean;
  } | null>(null);
  /** Whether the rate editor is showing. Closed by default: seeing the figure is the common need. */
  const [rateOpen, setRateOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState<{ currency: Currency; text: string } | null>(
    // An existing transaction whose rate was corrected by hand keeps that correction, and keeps it as
    // a correction: reverting to the reference rate has to be a deliberate act.
    editing?.fx_source === "manual"
      ? { currency: editing.currency as Currency, text: String(editing.fx_rate) }
      : null,
  );
  // Captured once when the sheet opens: the duplicate window is relative to that moment,
  // and reading the clock during render would make the memo impure.
  const [nowMs] = useState(() => Date.now());

  // Preselect the account this category was last paid from. Derived rather than stored in an
  // effect: an effect that setStates on every category change causes a cascading render, and
  // the value is a pure function of (category, history, prefs) anyway. An explicit tap wins.
  const predictedAccountId = useMemo(
    () =>
      resolveAccountId({
        contextAccountId,
        categoryId,
        lastByCategory: prefs?.lastAccountByCategory,
        defaultAccountId: me.default_account_id ?? null,
        transactions,
        /*
         * Accounts excluded from totals are never *predicted*, only ever chosen deliberately.
         *
         * "История Saldo" holds imported and hand-entered history and is excluded from balances.
         * Without this filter, logging one historical grocery run against it would teach
         * lastAccountByCategory that groceries belong to Saldo — and the next real grocery
         * expense would silently land in an account that does not move any balance. Still fully
         * selectable in the picker below; just never offered on its own.
         */
        availableIds: accounts.filter((a) => a.exclude_from_totals === 0).map((a) => a.id),
      }),
    [contextAccountId, categoryId, prefs, me.default_account_id, transactions, accounts],
  );

  const accountId = accountOverride ?? predictedAccountId;
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const currency: Currency = (account?.currency as Currency) ?? baseCurrency;

  /** What a rate in state has to be a rate for, to still be the right one. */
  const rateKey = `${currency}:${occurredOn}:${baseCurrency}`;

  useEffect(() => {
    let live = true;
    // Called even when the currency is the base, where it answers 1 with no I/O. One path rather than
    // a synchronous branch that sets state during the effect — which is what triggers a cascade.
    void rateFor(currency, occurredOn, baseCurrency).then((found) => {
      if (live) setSourceRate({ for: rateKey, ...found });
    });
    return () => {
      live = false;
    };
  }, [currency, occurredOn, baseCurrency, rateKey]);

  /**
   * The rate this transaction will be saved with, and whether it is the person's own.
   *
   * Derived rather than stored so the field and the save can never disagree — the bug this shape
   * prevents is a rate shown on screen and a different one written to the row.
   */
  const resolvedRate = sourceRate?.for === rateKey ? sourceRate : null;
  const rateText = manualEntry?.currency === currency ? manualEntry.text : null;
  const typedRate = rateText === null ? null : Number(rateText.replace(",", "."));
  const manualRate =
    typedRate !== null && Number.isFinite(typedRate) && typedRate > 0 ? typedRate : null;
  const amountMinor = evaluate(expression, currency);
  /** What this costs the household, at whatever rate is in force — source or corrected. */
  const convertedMinor = Math.round(amountMinor * (manualRate ?? resolvedRate?.rate ?? 1));
  /*
   * The amount line: the expression as typed, or the figure once there is only a figure.
   *
   * Empty while the pad is open and nothing has been keyed. A `0` sitting in an active field is a
   * value the field does not have — it reads as an amount already entered, and the first digit
   * then looks like it replaced something rather than like it was the first thing typed. Closed
   * and empty, the `0` comes back: a blank field with no keypad under it looks broken.
   */
  const amountText =
    isEmpty(expression) && keypadOpen ? "" : formatExpression(expression, currency, locale);
  /*
   * The figure shrinks rather than clipping, the way a calculator's does. A receipt of three or
   * four terms is longer than any single amount, and losing the end of it — which is the part
   * being typed — would be worse than losing a few points of type size.
   */
  const amountSize =
    amountText.length <= 12
      ? "text-[32px]"
      : amountText.length <= 18
        ? "text-[26px]"
        : amountText.length <= 26
          ? "text-[20px]"
          : "text-[17px]";

  /*
   * In seeded order, on purpose — never re-ranked by usage.
   *
   * The decay-weighted ranking that ordered the old quick tiles made sense when only six
   * categories fit on screen: the six had to be the right six. The picker sheet shows all of
   * them, so what speed comes from now is the finger knowing where a tile lives — and a
   * ranking that promotes last week's habit moves every tile below it. A stable grid is
   * slower on day one and faster every day after.
   */
  const pickerCategories = useMemo(
    () => (kind === "transfer" ? [] : allCategories.filter((c) => c.kind === kind)),
    [allCategories, kind],
  );

  const selectedCategory = allCategories.find((c) => c.id === categoryId);

  useEffect(() => {
    void getDevicePrefs().then(setPrefs);
  }, []);

  // Warn if the other person just logged something that looks like the same thing. Derived,
  // not stored: it is a pure function of the current form and the local rows. Never blocking —
  // a false positive must cost a glance, not a lost entry.
  const duplicateWarning = useMemo(() => {
    if (editing || amountMinor <= 0) return null;

    const hit = findLikelyDuplicate(transactions, {
      categoryId,
      amountMinor,
      occurredOn,
      authorId: me.id,
    });
    if (!hit) return null;

    const other = members.find((m) => m.id === hit.memberId);
    const category = allCategories.find((c) => c.id === hit.transaction.category_id);
    return t("entry.duplicateWarning", {
      name: other?.display_name ?? "",
      amount: formatMoney(hit.transaction.amount_minor, hit.transaction.currency, locale),
      category: category?.name ?? "",
      ago: t("date.minutesAgo", {
        count: Math.max(1, Math.round((nowMs - hit.transaction.updated_at) / 60_000)),
      }),
    });
  }, [
    editing,
    amountMinor,
    categoryId,
    occurredOn,
    transactions,
    members,
    allCategories,
    me.id,
    t,
    locale,
    nowMs,
  ]);

  const needsDestination = kind === "transfer";
  const crossCurrency =
    needsDestination && toAccount && account && toAccount.currency !== account.currency;

  const canSave =
    amountMinor > 0 &&
    Boolean(account) &&
    (needsDestination
      ? Boolean(toAccount) && (!crossCurrency || (toAmountMinor ?? 0) > 0)
      : Boolean(categoryId));

  /*
   * Physical keyboard entry.
   *
   * Without this the app is unusable with a mouse: the amount is a button that opens an on-screen
   * keypad, so entering 1550 on a computer meant clicking four keys on a phone dialler. The keypad
   * is right for a thumb and absurd for someone sitting at a keyboard.
   *
   * Reuses the same `calc.ts` functions the on-screen keys call, so both paths share one tested
   * implementation of the arithmetic and the currency's digit limit.
   *
   * Not gated on pointer type: an iPad with a keyboard attached should behave the same way.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The note field and the search box are real text inputs. Their keystrokes are theirs.
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      // Escape belongs to the sheet, which closes on it; modified keys belong to the browser.
      if (event.key === "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        setExpression((current) => pressDigit(current, event.key, currency));
        return;
      }

      // Both separators, whichever the keyboard produces and whichever the locale expects.
      if (event.key === "." || event.key === ",") {
        event.preventDefault();
        setExpression((current) => pressDecimal(current, currency));
        return;
      }

      if (event.key === "+" || event.key === "-" || event.key === "*" || event.key === "/") {
        event.preventDefault();
        const operator = event.key satisfies Operator;
        setExpression((current) => pressOperator(current, operator));
        return;
      }

      // The display shows the working until this key, so a hardware keyboard needs it as much as
      // the pad does. Enter is not it: Enter saves.
      if (event.key === "=") {
        event.preventDefault();
        setExpression((current) => pressEquals(current, currency));
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        setExpression(pressBackspace);
        return;
      }

      // Enter saves, but only from the sheet's own surface — never while a button is focused, or
      // it would fire that button and save at the same time.
      if (event.key === "Enter" && canSave && !(active instanceof HTMLButtonElement)) {
        event.preventDefault();
        void handleSave();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // No dependency array on purpose. The handler closes over `currency`, `canSave` and
    // `handleSave`, all of which change as the form is filled in, and `handleSave` is a new
    // function every render — so a dependency list would either be a lie or list everything.
    // Re-binding one document listener per render is cheap, and cleanup runs in the same commit as
    // setup, so there is no window where the keyboard is dead.
  });

  /**
   * Writes a split as one transaction per line, all sharing a `split_parent_id`.
   *
   * Separate rows rather than a parent plus children, because every report already aggregates by
   * category and would need special-casing otherwise — and the lines sum to the original by
   * construction, since SplitSheet refuses to confirm until the remainder is zero.
   */
  async function handleSplitSave(lines: { categoryId: string; amountMinor: number }[]) {
    if (!account) return;

    const fxRate = await rateFor(currency, occurredOn, baseCurrency);
    const parentId = editing?.split_parent_id ?? newId();

    await putMany(
      lines.map((line) => ({
        created_by: editing ? (editing.created_by ?? editing.updated_by ?? null) : me.id,
        table: "transactions" as const,
        row: {
          id: newId(),
          kind,
          occurred_on: occurredOn,
          account_id: account.id,
          to_account_id: null,
          category_id: line.categoryId,
          amount_minor: line.amountMinor,
          currency,
          to_amount_minor: null,
          to_currency: null,
          base_amount_minor: Math.round(line.amountMinor * fxRate.rate),
          fx_rate: fxRate.rate,
          fx_estimated: fxRate.estimated ? 1 : 0,
          note: note.trim() || null,
          payee: null,
          tags: null,
          split_parent_id: parentId,
          // The same photo on every line. A split is one receipt spread across categories, so each
          // row points at the one object rather than the receipt belonging to whichever line
          // happened to be first.
          receipt_key: receiptKey,
          import_hash: null,
        },
      })),
      me,
    );

    // Replaces the single transaction being edited, if any.
    if (editing) await remove("transactions", editing.id, me);

    setSplitting(false);
    onSaved();
  }

  async function handleSave() {
    if (!canSave || !account) return;

    /*
     * The rate already on screen, not a fresh lookup.
     *
     * Re-fetching here would discard a correction the person just typed — and would do it silently,
     * because the saved amount would still look plausible. The fallback is only for the case where the
     * effect has not resolved yet, which the sheet's own state machine makes nearly impossible.
     */
    const resolved = resolvedRate ?? (await rateFor(currency, occurredOn, baseCurrency));
    const rate = manualRate ?? resolved.rate;
    const estimated = manualRate === null && resolved.estimated;
    const id = editing?.id ?? newId();

    const row: Record<string, unknown> = {
      id,
      kind,
      occurred_on: occurredOn,
      account_id: account.id,
      to_account_id: needsDestination ? toAccount!.id : null,
      category_id: needsDestination ? null : categoryId,
      amount_minor: amountMinor,
      currency,
      to_amount_minor: needsDestination ? (crossCurrency ? (toAmountMinor ?? 0) : amountMinor) : null,
      to_currency: needsDestination ? toAccount!.currency : null,
      base_amount_minor: Math.round(amountMinor * rate),
      fx_rate: rate,
      fx_estimated: estimated ? 1 : 0,
      /*
       * Recorded so the nightly reconcile knows what it may touch. A hand-entered rate is the fact for
       * this household — the bank's own figure — and re-pricing it from a reference rate overnight
       * would replace a deliberate correction with an approximation, silently.
       */
      fx_source: manualRate !== null ? "manual" : estimated ? "estimated" : "auto",
      note: note.trim() || null,
      payee: editing?.payee ?? null,
      tags: null,
      split_parent_id: editing?.split_parent_id ?? null,
      receipt_key: receiptKey,
      import_hash: editing?.import_hash ?? null,
      // Preserved through edits, stamped fresh on creation. The fallback to updated_by covers a
      // row edited before its mirror learnt the new column.
      created_by: editing ? (editing.created_by ?? editing.updated_by ?? null) : me.id,
    };

    await put("transactions", row as never, me);

    // Remember the pairing for next time. Device-local: it is a habit of this phone's owner.
    // Not recorded for excluded accounts — backfilling history must not retrain the predictions
    // used for everyday entry.
    if (categoryId && account.exclude_from_totals === 0) {
      const prefs = await getDevicePrefs();
      await setDevicePrefs({
        lastAccountByCategory: { ...prefs.lastAccountByCategory, [categoryId]: account.id },
      });
    }

    // The sheet closing and the row appearing in the list are the confirmation; the undo cloud
    // retired once deletion got its own hold-to-confirm safeguard.
    onSaved();
  }

  const today = todayIso();
  const yesterday = addDaysIso(today, -1);

  /**
   * The date, as three chips on one line.
   *
   * Not a row that opens a picker, unlike the fields below it, and the exception is earned: nine
   * entries in ten are today or yesterday, and those are one tap here against three through a sheet.
   * The calendar behind the third chip covers the rest without costing the common case anything.
   */
  const dateRow = (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      <Chip active={occurredOn === today} onClick={() => setOccurredOn(today)}>
        {t("entry.today")}
      </Chip>
      <Chip active={occurredOn === yesterday} onClick={() => setOccurredOn(yesterday)}>
        {t("entry.yesterday")}
      </Chip>
      {/* The native input on a phone, a calendar of our own on a desktop — see DateChip. */}
      <DateChip
        value={occurredOn}
        max={today}
        onChange={setOccurredOn}
        pickLabel={t("entry.pickDate")}
      />
    </div>
  );

  const accountRow = (
    <EntryRow
      icon={account?.icon ?? "💳"}
      color={account?.color}
      label={needsDestination ? t("entry.from") : t("entry.account")}
      value={account?.name}
      placeholder={t("entry.account")}
      onClick={() => setPicker("account")}
    />
  );

  const toRow = needsDestination ? (
    <>
      <EntryRow
        icon={toAccount?.icon ?? "🏦"}
        color={toAccount?.color}
        label={t("entry.to")}
        value={toAccount?.name}
        placeholder={t("entry.to")}
        onClick={() => setPicker("to")}
      />

      {/* Cross-currency transfers take both legs explicitly rather than deriving the
          second from a rate, so neither balance inherits a rounding error. */}
      {crossCurrency && (
        <div className={cn(CARD, "mt-3")}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {toAccount!.name} {t("entry.receives")}
            </span>
            <Amount
              minor={toAmountMinor ?? 0}
              currency={toAccount!.currency as Currency}
              tone="income"
              cents
            />
          </div>
          {/*
            The pad, not a text field. This leg used to take digits through a raw input that
            stripped anything but `[\d.,]` straight into an expression's `current` — no arithmetic,
            no grouping, and the only amount in the app whose display disagreed with the one
            directly above it.
          */}
          <div className="mt-2">
            <AmountField
              valueMinor={toAmountMinor}
              currency={toAccount!.currency as Currency}
              onChange={setToAmountMinor}
              label={`${toAccount!.name} ${t("entry.amount")}`}
            />
          </div>
        </div>
      )}
    </>
  ) : null;

  const categoryRow = (
    <EntryRow
      icon={selectedCategory?.icon ?? "🏷️"}
      color={selectedCategory?.color}
      label={t("entry.category")}
      value={selectedCategory?.name}
      placeholder={t("entry.chooseCategory")}
      onClick={() => setPicker("category")}
    />
  );

  /**
   * The note, typed in place.
   *
   * Under the amount rather than at the foot of the form, which is where it was: a comment is the
   * second thing anyone adds after the number, and it had been sitting below two pickers where the
   * keypad reached it.
   */
  const noteRow = (
    <input
      type="text"
      className="mt-3 w-full rounded-none border-0 border-b border-border bg-transparent py-2.5 focus:border-b-primary focus:outline-none"
      value={note}
      onChange={(event) => setNote(event.target.value)}
      onFocus={() => setKeypadOpen(false)}
      placeholder={t("entry.notePlaceholder")}
      aria-label={t("entry.note")}
    />
  );

  /** Deletes and closes, leaving the undo on the toast — the same contract as a swipe. */
  async function handleDelete(tx: Transaction) {
    await remove("transactions", tx.id, me);
    onSaved();
  }

  /**
   * Turns this transaction into a monthly schedule.
   *
   * Monthly on the transaction's own day-of-month, because that is what a recurring payment almost
   * always is — rent, a subscription, a standing transfer. Weekly and yearly exist but guessing
   * between them from a single transaction would be a coin flip, so the schedule is created and the
   * toast says where to change it.
   *
   * Transfers cannot become schedules: a template needs a category, and a transfer has none.
   */
  async function handleMakeRecurring(tx: Transaction) {
    if (!tx.category_id) return;
    const template: QuickTileTemplate = {
      kind: tx.kind === "income" ? "income" : "expense",
      amount_minor: tx.amount_minor,
      currency: tx.currency as Currency,
      category_id: tx.category_id,
      account_id: tx.account_id,
      note: tx.note ?? null,
    };
    const category = allCategories.find((c) => c.id === tx.category_id);
    const label = tx.note?.trim() || category?.name || t(`kind.${tx.kind}`);
    const dayOf = Number(tx.occurred_on.slice(8, 10));

    await put(
      "recurring",
      {
        id: newId(),
        label,
        template: serialiseTemplate(template),
        cadence: "monthly",
        day_of: dayOf,
        // Never today: posting it immediately would duplicate the transaction it came from.
        next_on: nextOccurrence(tx.occurred_on, "monthly", dayOf),
        active: 1,
      } as never,
      me,
    );

    onSaved({ message: t("entry.madeRecurring", { label }) });
  }

  /**
   * The bar between the form and the keypad: optional things on the left, Save on the right.
   *
   * Save lives here rather than inside the keypad, and that is the fix for having had two of them —
   * a key on the pad and a button in the footer, so the control that commits the entry moved
   * depending on whether the pad happened to be open. One button, always in the same place, whatever
   * else is on screen.
   */
  /*
   * The bar holds what belongs to the entry being typed — photo, split, Save — and nothing else.
   * With "make recurring" here too, editing a transaction put four non-shrinking controls on one
   * line and Save printed over its neighbour (buttons are whitespace-nowrap by design; the fix for
   * an overflowing bar is fewer things on it, not smaller taps). Actions on the *existing* row —
   * make recurring, delete — live at the end of the form with each other.
   */
  const actionBar = (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <ReceiptField receiptKey={receiptKey} onChange={setReceiptKey} />

        {/* Only once there is an amount to divide, and never for transfers, which move money
            rather than spend it on anything. */}
        {!needsDestination && amountMinor > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSplitting(true)}>
            {t("entry.split")}
          </Button>
        )}
      </div>

      <Button
        variant="primary"
        layoutClassName="shrink-0"
        disabled={!canSave}
        onClick={() => void handleSave()}
      >
        {t("entry.save")}
      </Button>
    </div>
  );

  /*
   * Delete stays in the body, at the end, and deliberately not on the bar beside Save. A destructive
   * control next to the one the thumb reaches for to commit is the neighbour problem — and unlike
   * everything else on the bar, this one cannot be undone by pressing it again.
   */
  const deleteRow = editing ? (
    <div className="mt-4 flex items-center justify-between gap-3">
      {/* Acts on the saved row, like delete — and unlike everything on the bar. Opposite ends:
          the constructive action must not sit where a thumb reaching for delete lands. */}
      {editing.kind !== "transfer" && editing.category_id ? (
        <Button variant="ghost" size="sm" onClick={() => void handleMakeRecurring(editing)}>
          {t("entry.makeRecurring")}
        </Button>
      ) : (
        <span />
      )}
      <HoldButton onConfirm={() => void handleDelete(editing)}>{t("history.delete")}</HoldButton>
    </div>
  ) : null;

  /**
   * The kind switch, rendered as the sheet's title.
   *
   * It is what the dialog is about, so a separate heading saying "New transaction" above it was the
   * same information twice — and it cost a row on a form that has to fit above the keypad.
   */
  const kindSwitch = (
    <div
      className="mr-2 flex min-w-0 flex-1 rounded-lg bg-muted p-1"
      role="group"
      aria-label={t("entry.kind")}
    >
      {(["expense", "income", "transfer"] as TxKind[]).map((option) => (
        <button
          key={option}
          type="button"
          className={cn(
            "min-h-9 min-w-0 flex-1 truncate rounded-md text-sm font-medium text-muted-foreground",
            kind === option && "bg-background text-foreground shadow-sm",
          )}
          aria-pressed={kind === option}
          onClick={() => {
            // Guard on a real change: tapping the current kind used to clear the category.
            if (option === kind) return;
            setKind(option);
            setCategoryId(null);
          }}
        >
          {t(`kind.${option}`)}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet
      title={editing ? t("history.edit") : t("nav.add")}
      titleControl={kindSwitch}
      /* Full screen always, at the user's request: a content-height sheet meant scrolling to reach
         the category row whenever the keypad was up, and a form that scrolls is a form that hides. */
      fill
      onClose={onClose}
      footer={
        <>
          {actionBar}
          {keypadOpen && (
            <Keypad expression={expression} currency={currency} onChange={setExpression} />
          )}
        </>
      }
    >
      {/*
        The amount block: what it costs the household, above what it costs in the account's own
        currency, with the code of that currency alongside.

        The converted figure sits *above* rather than in a field of its own. It is the same fact the
        rate is, said in the only unit anyone reasons about — and as a line above the number it needs
        no label, no row, and no explanation. Tapping it opens the rate, which is where the small
        number came from; that is a far better home for the control than a permanent field, because
        the rate is worth correcting perhaps twice a year and worth *seeing* every time.
      */}
      <div className="mt-3">
        {currency !== baseCurrency && (
          <button
            type="button"
            data-slot="converted-amount"
            className="block px-3 pb-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground active:opacity-70"
            onClick={() => setRateOpen(true)}
          >
            {formatMoney(convertedMinor, baseCurrency, locale, { cents: true })}
            {manualRate !== null && (
              <span className="ml-0.5" title={t("entry.rateEdited")} aria-hidden>
                ✎
              </span>
            )}
          </button>
        )}

        {/* No currency badge beside the field: the symbol inside the amount already says it, and the
            same fact twice on one line reads as two facts. The account row below is where the
            currency is *chosen*, via the account. */}
        <div className="flex items-stretch gap-2">
          {/* The amount doubles as the control that summons the keypad, so there is one obvious
              place to tap rather than a separate affordance. */}
          <button
            type="button"
            className={cn(
              // Centred, not baseline-aligned: the figure changes type size as the expression grows.
              "flex min-h-14 w-full items-center justify-start gap-2 rounded-lg border px-3 py-2.5",
              keypadOpen ? "border-primary bg-secondary" : "border-border bg-card",
            )}
            onClick={() => {
              setKeypadOpen(true);
              setRateOpen(false);
            }}
            aria-expanded={keypadOpen}
            aria-label={t("entry.amount")}
          >
            {/*
              One line, showing exactly what was keyed: `120 + 45,5` while an expression is open,
              the result once `=` closes it. Two things were wrong with showing the running total
              here instead. The number in the biggest type on screen was one nobody had typed —
              `120 + 45` drew as 165 — and, because it was a *number*, anything typed that did not
              change it was invisible: `45`, `45,` and `45,0` were all `45`, so the decimal key
              looked broken until a second fraction digit arrived.
            */}
            {/* Equal-width digits, unlike other figures this size. This one changes under the
                finger — every keypress rewrites it — and proportional digits make it jitter
                sideways as 1s and 8s trade places. Alignment here is against its own previous
                frame. */}
            <span
              className={cn(
                "sensitive block min-w-0 flex-1 truncate text-left font-bold tabular-nums tracking-tight",
                amountSize,
                kind === "expense" && "text-expense",
                kind === "income" && "text-income",
                kind === "transfer" && "text-transfer",
              )}
              aria-live="polite"
            >
              {amountText}
            </span>
          </button>

        </div>

      </div>

      {noteRow}
      {dateRow}

      {/* The fields that open a picker, grouped: one card, one border, no gaps to read as breaks. */}
      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
        {accountRow}
        {needsDestination ? toRow : categoryRow}
      </div>

      {deleteRow}

      {duplicateWarning && (
        <div
          className={cn(CARD, "mt-3 border-warning")}
          role="status"
        >
          <div className="text-xs">{duplicateWarning}</div>
        </div>
      )}

      {/*
        The rate, in a sheet like the other pickers rather than expanding under the amount.
        Opened by tapping the converted figure — where someone who disagrees with it is already
        looking — and opened unasked when no rate was published for the date, because a guess nobody
        can see is a guess nobody can fix.
      */}
      {currency !== baseCurrency &&
        (rateOpen || (rateText === null && resolvedRate?.estimated && amountMinor > 0)) && (
          <Sheet title={t("entry.rate", { quote: currency, base: baseCurrency })} onClose={() => setRateOpen(false)}>
            <RateField
              amountMinor={amountMinor}
              currency={currency}
              rate={rateText ?? (resolvedRate ? formatRate(resolvedRate.rate) : "")}
              estimated={rateText === null && (resolvedRate?.estimated ?? true)}
              edited={rateText !== null}
              onChange={(text) => setManualEntry({ currency, text })}
              onReset={() => setManualEntry(null)}
            />
          </Sheet>
        )}

      {picker === "category" && (
        <CategorySheet
          categories={pickerCategories}
          selectedId={categoryId}
          onSelect={setCategoryId}
          onClose={() => setPicker(null)}
        />
      )}

      {picker === "account" && (
        <AccountSheet
          title={needsDestination ? t("entry.from") : t("entry.account")}
          accounts={accounts}
          selectedId={accountId}
          baseCurrency={baseCurrency}
          onSelect={setAccountOverride}
          onClose={() => setPicker(null)}
        />
      )}

      {picker === "to" && (
        <AccountSheet
          title={t("entry.to")}
          accounts={accounts.filter((a) => a.id !== accountId)}
          selectedId={toAccountId}
          baseCurrency={baseCurrency}
          onSelect={setToAccountId}
          onClose={() => setPicker(null)}
        />
      )}

      {splitting && (
        <SplitSheet
          totalMinor={amountMinor}
          currency={currency}
          kind={kind === "income" ? "income" : "expense"}
          categories={pickerCategories}
          onClose={() => setSplitting(false)}
          onConfirm={(lines) => void handleSplitSave(lines)}
        />
      )}

      {!canSave && amountMinor > 0 && (
        <p className="text-xs text-muted-foreground">
          {needsDestination ? t("entry.needDestination") : t("entry.needCategory")}
        </p>
      )}
    </Sheet>
  );
}

