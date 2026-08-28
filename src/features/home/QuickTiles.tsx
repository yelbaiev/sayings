import type { Currency } from "@shared/currency";
import { cn } from "~/lib/cn";
import { Button } from "~/ui/Button";
import { HoldButton } from "~/ui/HoldButton";
import { CARD, HINT } from "~/ui/recipes";
import {
  parseTemplate,
  serialiseTemplate,
  type QuickTileTemplate,
} from "@shared/quick-tile";
import type { Account, Category, QuickTile, Transaction } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { newId, put, remove } from "~/db/mutations";
import { useAccounts, useCategories, useLatestTransaction, useQuickTiles } from "~/db/queries";
import { createPressGesture } from "~/lib/press-gesture";
import { AmountField } from "~/features/entry/AmountField";
import { useRepeatLast } from "~/features/entry/useRepeatLast";
import { rateFor } from "~/lib/fx";
import { formatMoney, todayIso } from "~/lib/format";
import { Field, IconChip, Sheet } from "~/ui";

/**
 * One-tap transactions pinned to Home.
 *
 * Per-member, because habits differ — his coffee is not her coffee. Tapping writes immediately,
 * the same optimistic path as the entry sheet, so there is no confirmation step to slow down the
 * thing that exists to be fast; the row appearing in the list below is the receipt.
 */
export function QuickTiles() {
  const { t, me, locale, baseCurrency } = useApp();
  const tiles = useQuickTiles(me.id);
  const accounts = useAccounts(true);
  const categories = useCategories(undefined, true);
  // Queried here, in a component that has been mounted long enough for Dexie to have resolved,
  // and handed to the sheet as props. A sheet that queries on its own first render sees empty
  // arrays, and any useState initialiser reading them silently gets nothing.
  const selectableAccounts = useAccounts();
  const expenseCategories = useCategories("expense");
  const incomeCategories = useCategories("income");
  const last = useLatestTransaction();
  const repeatLast = useRepeatLast();
  const [editing, setEditing] = useState<QuickTile | "new" | null>(null);
  const [editMode, setEditMode] = useState(false);

  const resolved = useMemo(
    () =>
      tiles
        .map((tile) => ({ tile, template: parseTemplate(tile.template) }))
        // A tile whose category or account has since been deleted would produce an invalid
        // transaction, so it is dropped rather than offered.
        .filter(
          (entry): entry is { tile: QuickTile; template: QuickTileTemplate } =>
            entry.template !== null &&
            categories.some((c) => c.id === entry.template!.category_id) &&
            accounts.some((a) => a.id === entry.template!.account_id),
        ),
    [tiles, categories, accounts],
  );

  async function fire(template: QuickTileTemplate) {
    const fx = await rateFor(template.currency, todayIso(), baseCurrency);
    const id = newId();

    await put(
      "transactions",
      {
        id,
        created_by: me.id,
        kind: template.kind,
        occurred_on: todayIso(),
        account_id: template.account_id,
        to_account_id: null,
        category_id: template.category_id,
        amount_minor: template.amount_minor,
        currency: template.currency,
        to_amount_minor: null,
        to_currency: null,
        base_amount_minor: Math.round(template.amount_minor * fx.rate),
        fx_rate: fx.rate,
        fx_estimated: fx.estimated ? 1 : 0,
        note: template.note ?? null,
        payee: null,
        tags: null,
        split_parent_id: null,
        receipt_key: null,
        import_hash: null,
      } as never,
      me,
    );

    // No toast, deliberately, second edition: the tile flash plus the row appearing in the list
    // below are the confirmation, and a mis-tap is one hold-to-delete away.
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {/*
          Repeat-last, as a tile.

          The gesture for it — a long press on the add button — has existed since before the tiles
          did, and nobody could find it: the string written for its label was referenced nowhere in
          the app. That is the same reason the edit affordance beside these tiles exists as a
          button, and the same fix. The gesture stays; this is a way in that can be seen.

          First in the row, because "the same thing again" is the commonest entry of all, and it is
          the tile that needs no setting up.
        */}
        {last && (
          <button
            type="button"
            className={cn(TILE, "border-dashed")}
            onClick={() => void repeatLast()}
            aria-label={`${t("entry.repeatLast")} ${formatMoney(last.amount_minor, last.currency as Currency, locale)}`}
          >
            <span aria-hidden>↻</span>
            <span>{t("entry.repeatLast")}</span>
            <span className="sensitive text-muted-foreground tabular-nums">
              {formatMoney(last.amount_minor, last.currency as Currency, locale)}
            </span>
          </button>
        )}

        {resolved.map(({ tile, template }) => (
          <QuickTileButton
            key={tile.id}
            tile={tile}
            icon={categories.find((c) => c.id === template.category_id)?.icon ?? "⚡"}
            amount={formatMoney(template.amount_minor, template.currency, locale)}
            editMode={editMode}
            onFire={() => void fire(template)}
            onEdit={() => setEditing(tile)}
          />
        ))}

        <button
          type="button"
          className={cn(TILE, "border-dashed px-4 text-xl font-normal text-muted-foreground")}
          onClick={() => setEditing("new")}
          aria-label={t("quickTile.add")}
        >
          +
        </button>

        {/* An explicit way in, because a long press is undiscoverable, unreachable by keyboard,
            and on iOS competes with the text-selection callout. */}
        {resolved.length > 0 && (
          <button
            type="button"
            className={cn(
              TILE,
              editMode
                ? "border-primary bg-primary font-semibold text-primary-foreground"
                : "border-dashed px-4 text-muted-foreground",
            )}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? t("quickTile.manageDone") : "✎"}
          </button>
        )}
      </div>

      {resolved.length > 0 && (
        <p className={HINT}>
          {editMode ? t("quickTile.editHintMode") : t("quickTile.editHint")}
        </p>
      )}

      {editing && (
        <QuickTileSheet
          tile={editing === "new" ? undefined : editing}
          count={tiles.length}
          accounts={selectableAccounts}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          last={last}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/**
 * A single tile: tap fires it, holding opens its editor.
 *
 * The hold uses the tested gesture state machine rather than `onContextMenu`, which iOS Safari
 * does not fire for touch — there, a long press starts a text selection and shows the copy
 * callout instead. The CSS suppresses both (see .quick-tile), and in edit mode a plain tap edits,
 * so the gesture is never the only route in.
 */
/*
 * The tile recipe. Chunky on purpose — a one-tap target used many times a day — and with iOS text
 * selection suppressed, because a long press must open the editor, not the copy callout.
 */
const TILE = cn(
  "flex min-h-11 shrink-0 select-none items-center gap-1.5 whitespace-nowrap",
  "rounded-full border border-border bg-card px-3 text-sm font-medium",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "active:scale-[0.97] active:border-primary active:bg-secondary",
  "[-webkit-touch-callout:none] [touch-action:manipulation]",
);

function QuickTileButton({
  tile,
  icon,
  amount,
  editMode,
  onFire,
  onEdit,
}: {
  tile: QuickTile;
  icon: string;
  amount: string;
  editMode: boolean;
  onFire: () => void;
  onEdit: () => void;
}) {
  const gesture = useMemo(
    () =>
      createPressGesture({
        onTap: () => (editMode ? onEdit() : onFire()),
        // No hold target in edit mode: a tap already edits there.
        onLongPress: editMode ? undefined : onEdit,
      }),
    [editMode, onEdit, onFire],
  );

  return (
    <button
      type="button"
      className={cn(TILE, editMode && "border-dashed border-primary")}
      onPointerDown={() => gesture.down()}
      onPointerUp={() => gesture.up()}
      onPointerLeave={() => gesture.cancel()}
      onPointerCancel={() => gesture.cancel()}
      // Keyboard never produces pointer events, so activation needs its own path.
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (editMode) onEdit();
          else onFire();
        }
      }}
      aria-label={`${tile.label} ${amount}`}
    >
      <span aria-hidden>{editMode ? "✎" : icon}</span>
      <span>{tile.label}</span>
      <span className="sensitive text-muted-foreground tabular-nums">{amount}</span>
    </button>
  );
}

/**
 * Exported for tests, not for other screens.
 *
 * It is worth testing directly because the bug it carries the scar of — a `<select>` holding a value
 * that matches none of its options, so the browser draws the first one while the component believes
 * nothing is chosen — is invisible from the outside and was reported as "Выберите счёт" appearing
 * beside an apparently chosen account.
 */
export function QuickTileSheet({
  tile,
  count,
  accounts,
  expenseCategories,
  incomeCategories,
  last,
  onClose,
}: {
  tile?: QuickTile | undefined;
  count: number;
  accounts: Account[];
  expenseCategories: Category[];
  incomeCategories: Category[];
  last: Transaction | undefined;
  onClose: () => void;
}) {
  const { t, me, baseCurrency, enabledCurrencies } = useApp();

  const existing = tile ? parseTemplate(tile.template) : null;

  // A new tile is prefilled from the most recent transaction, which is usually close to what is
  // being pinned and saves filling four fields.
  const [kind, setKind] = useState<"expense" | "income">(
    existing?.kind ?? (last?.kind === "income" ? "income" : "expense"),
  );
  const [label, setLabel] = useState(tile?.label ?? "");
  /*
   * Resolved before the amount, because the amount is scaled by it. Dividing by 100 here would
   * prefill a ¥500 tile as "5" and save five yen — a field the user never touched, silently wrong.
   */
  const prefillCurrency: Currency =
    existing?.currency ?? ((last?.currency as Currency | undefined) ?? baseCurrency);
  // Minor units throughout, so the prefill cannot be re-scaled by a currency it did not come from
  // — the trap the comment above describes.
  const [amountMinor, setAmountMinor] = useState<number | null>(
    existing?.amount_minor ?? last?.amount_minor ?? null,
  );
  const [currency, setCurrency] = useState<Currency>(prefillCurrency);
  const [categoryId, setCategoryId] = useState(
    existing?.category_id ?? last?.category_id ?? "",
  );
  const [accountId, setAccountId] = useState(() => {
    // Falls through anything not in the dropdown, which would otherwise leave the select
    // looking valid while holding an unselectable id.
    const candidates = [existing?.account_id, last?.account_id, accounts[0]?.id];
    return candidates.find((id) => id && accounts.some((a) => a.id === id)) ?? "";
  });
  const [error, setError] = useState<string | null>(null);

  const categories = kind === "expense" ? expenseCategories : incomeCategories;

  async function save() {
    // Each failure names its own field. A single shared message meant a missing category
    // reported itself as a missing amount, which is how this looked like an input bug.
    // The pad cannot produce anything unparseable, so the try/catch the text input needed is gone.
    const minor = amountMinor ?? 0;
    if (minor <= 0) {
      setError(t("entry.needAmount"));
      return;
    }
    if (!categoryId) {
      setError(t("entry.needCategory"));
      return;
    }
    if (!accountId || !accounts.some((a) => a.id === accountId)) {
      setError(t("entry.needAccount"));
      return;
    }

    const template: QuickTileTemplate = {
      kind,
      amount_minor: minor,
      currency,
      category_id: categoryId,
      account_id: accountId,
    };

    await put(
      "quick_tiles",
      {
        id: tile?.id ?? newId(),
        member_id: me.id,
        // Falls back to the category name, so a tile is never unlabelled.
        label: label.trim() || (categories.find((c) => c.id === categoryId)?.name ?? "—"),
        template: serialiseTemplate(template),
        sort_order: tile?.sort_order ?? count + 1,
      } as never,
      me,
    );
    onClose();
  }

  return (
    <Sheet title={tile ? t("quickTile.edit") : t("quickTile.add")} onClose={onClose}>
      <div className="mb-3 flex w-full rounded-lg bg-muted p-1" role="group">
        {(["expense", "income"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={cn(
              "min-h-9 flex-1 rounded-md text-sm font-medium text-muted-foreground",
              kind === option && "bg-background text-foreground shadow-sm",
            )}
            aria-pressed={kind === option}
            onClick={() => {
              // Only on a real change. Firing this for the already-selected kind wiped a
              // category the user had just chosen, and the failure then surfaced as an
              // unrelated "enter the amount" message.
              if (option === kind) return;
              setKind(option);
              setCategoryId("");
            }}
          >
            {t(`kind.${option}`)}
          </button>
        ))}
      </div>

      <Field label={t("quickTile.label")} hint={t("quickTile.labelHint")}>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t("quickTile.labelPlaceholder")}
          autoFocus
        />
      </Field>

      <Field label={t("entry.amount")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">
            <AmountField
              valueMinor={amountMinor}
              currency={currency}
              onChange={setAmountMinor}
              label={t("entry.amount")}
            />
          </span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            aria-label={t("accounts.currency")}
            className="w-auto"
          >
            {enabledCurrencies.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </Field>

      <Field label={t("entry.category")}>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("entry.account")}>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          {/* An explicit empty option so a value matching nothing renders as "—" instead of
              silently displaying the first account while holding no selection. That mismatch is
              what made "Выберите счёт" appear next to an apparently chosen account. */}
          <option value="">—</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.currency}
            </option>
          ))}
        </select>
      </Field>

      {categoryId && (
        <div className={cn(CARD, "mt-2 flex flex-wrap items-center gap-2")}>
          <IconChip
            icon={categories.find((c) => c.id === categoryId)?.icon ?? "⚡"}
            color={categories.find((c) => c.id === categoryId)?.color}
            small
          />
          <span className="text-xs text-muted-foreground">{t("quickTile.preview")}</span>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button variant="primary" block layoutClassName="mt-4" onClick={() => void save()}>
        {t("common.save")}
      </Button>

      {tile && (
        <HoldButton block layoutClassName="mt-2" onConfirm={() => void remove("quick_tiles", tile.id, me).then(onClose)}>
          {t("common.delete")}
        </HoldButton>
      )}
    </Sheet>
  );
}
