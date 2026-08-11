import type { Currency } from "@shared/currency";
import { minorToMajor, parseMajorToMinor } from "@shared/money";
import { ACCOUNT_TYPES, type Account } from "@shared/schema";
import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { newId, put } from "~/db/mutations";
import { useAccounts, useBalances } from "~/db/queries";
import { IconButton } from "~/ui/Button";
import { Amount, Chip, EmptyState, Field, FieldGroup, IconChip, Sheet } from "~/ui";
import { Button } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { HINT, LIST, PAGE, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE, SECTION_TITLE } from "~/ui/recipes";

const ICON_CHOICES = ["💳", "💵", "🏦", "🐷", "📈", "💰", "🪙", "📱"];
const COLOR_CHOICES = ["#3E63DD", "#30A46C", "#E93D82", "#F76B15", "#8E4EC6", "#6E6E76"];

type AccountTypeKey = `accounts.type.${(typeof ACCOUNT_TYPES)[number]}`;

export function AccountsPage() {
  const { t, me } = useApp();
  const balances = useBalances();
  const accounts = useAccounts(true);
  const [editing, setEditing] = useState<Account | "new" | null>(null);

  const active = balances.filter((b) => b.account.archived === 0);
  const archived = balances.filter((b) => b.account.archived === 1);

  /**
   * Swaps an account with its neighbour so the frequently-used ones can sit on top — this order
   * drives both this list and the account chips on the entry screen.
   *
   * Arrow buttons rather than drag-and-drop: reliable under a thumb, reachable by keyboard and
   * assistive tech, and no dependency. Sort orders are rewritten densely from the resulting
   * sequence, because the seeded values have gaps and a plain swap would not always reorder.
   */
  async function move(accountId: string, direction: -1 | 1) {
    const order = active.map((b) => b.account);
    const from = order.findIndex((a) => a.id === accountId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= order.length) return;

    const reordered = [...order];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);

    for (const [index, account] of reordered.entries()) {
      if (account.sort_order === index + 1) continue;
      await put("accounts", { ...account, sort_order: index + 1 } as never, me);
    }
  }

  return (
    <div className={PAGE}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className={cn(PAGE_TITLE, "mb-0")}>{t("accounts.title")}</h1>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("accounts.add")}
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState icon="💳" message={t("accounts.empty")} />
      ) : (
        <>
          <div className={LIST}>
            {active.map(({ account, native }, index) => (
              <div key={account.id} className={ROW}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  onClick={() => setEditing(account)}
                >
                  <IconChip icon={account.icon} color={account.color} />
                  <span className="min-w-0 flex-1">
                    <span className={ROW_TITLE}>{account.name}</span>
                    <span className={ROW_SUB}>
                      {t(`accounts.type.${account.type}` as AccountTypeKey)} · {account.currency}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Amount
                      minor={native}
                      currency={account.currency as Currency}
                      tone={native < 0 ? "expense" : "neutral"}
                      cents
                    />
                  </span>
                </button>

                <span className="flex shrink-0 flex-col">
                  <IconButton
                    shape="wide"
                    label={t("accounts.moveUp")}
                    disabled={index === 0}
                    onClick={() => void move(account.id, -1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    shape="wide"
                    label={t("accounts.moveDown")}
                    disabled={index === active.length - 1}
                    onClick={() => void move(account.id, 1)}
                  >
                    ↓
                  </IconButton>
                </span>
              </div>
            ))}
          </div>

          {archived.length > 0 && (
            <section className="mt-6">
              <h2 className={SECTION_TITLE}>{t("accounts.archived")}</h2>
              <div className={LIST}>
                {archived.map(({ account, native }) => (
                  <button
                    key={account.id}
                    type="button"
                    className={cn(ROW, "hover:bg-accent active:bg-accent")}
                    onClick={() => setEditing(account)}
                  >
                    <IconChip icon={account.icon} />
                    <span className="min-w-0 flex-1">
                      <span className={cn(ROW_TITLE, "text-muted-foreground")}>{account.name}</span>
                    </span>
                    <Amount minor={native} currency={account.currency as Currency} tone="muted" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {editing && (
        <AccountSheet
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AccountSheet({
  account,
  onClose,
}: {
  account?: Account | undefined;
  onClose: () => void;
}) {
  const { t, me, baseCurrency, enabledCurrencies } = useApp();
  const accounts = useAccounts(true);

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<Account["type"]>(account?.type ?? "debit_card");
  // A new account starts in the household's own currency, which is what most accounts will be.
  const [currency, setCurrency] = useState<Currency>((account?.currency as Currency) ?? baseCurrency);
  // Scaled by the account's own currency: /100 would show a yen balance at a hundredth of itself.
  const [openingBalance, setOpeningBalance] = useState(
    account
      ? String(minorToMajor(account.opening_balance_minor, account.currency as Currency))
      : "",
  );
  const [icon, setIcon] = useState(account?.icon ?? "💳");
  const [color, setColor] = useState(account?.color ?? "#3E63DD");
  const [excludeFromTotals, setExcludeFromTotals] = useState(
    account?.exclude_from_totals === 1,
  );
  const [archived, setArchived] = useState(account?.archived === 1);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError(t("accounts.name"));
      return;
    }

    let openingMinor = 0;
    if (openingBalance.trim()) {
      try {
        openingMinor = parseMajorToMinor(openingBalance, currency);
      } catch {
        setError(t("import.warning.noAmount"));
        return;
      }
    }

    await put(
      "accounts",
      {
        id: account?.id ?? newId(),
        name: name.trim(),
        type,
        currency,
        opening_balance_minor: openingMinor,
        icon,
        color,
        exclude_from_totals: excludeFromTotals ? 1 : 0,
        archived: archived ? 1 : 0,
        sort_order: account?.sort_order ?? accounts.length + 1,
      } as never,
      me,
    );
    onClose();
  }

  return (
    <Sheet title={account ? t("accounts.edit") : t("accounts.add")} onClose={onClose}>
      <Field label={t("accounts.name")}>
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>

      <Field label={t("accounts.type")}>
        <select
          value={type}
          onChange={(event) => setType(event.target.value as Account["type"])}
        >
          {ACCOUNT_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`accounts.type.${option}` as AccountTypeKey)}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t("accounts.currency")}
        hint={
          account
            ? "Changing this does not reinterpret existing transactions."
            : undefined
        }
      >
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        >
          {enabledCurrencies.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("accounts.openingBalance")}>
        <input
          type="text"
          inputMode="decimal"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          placeholder="0"
        />
      </Field>

      <FieldGroup label={t("categories.icon")}>
        <div className="flex flex-wrap items-center gap-2">
          {ICON_CHOICES.map((option) => (
            <Chip key={option} active={icon === option} onClick={() => setIcon(option)}>
              {option}
            </Chip>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label={t("categories.colour")}>
        <div className="flex flex-wrap items-center gap-2">
          {COLOR_CHOICES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              aria-label={option}
              aria-pressed={color === option}
              className={cn(
                "size-8 rounded-full border",
                color === option ? "border-[3px] border-foreground" : "border-border",
              )}
              // Data-driven colour, like IconChip: the swatch *is* the value.
              // eslint-disable-next-line no-restricted-syntax -- dynamic data colour
              style={{ background: option }}
            />
          ))}
        </div>
      </FieldGroup>

      <label className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <span>{t("accounts.excludeFromTotals")}</span>
        <input
          type="checkbox"
          checked={excludeFromTotals}
          onChange={(event) => setExcludeFromTotals(event.target.checked)}
        />
      </label>

      {account && (
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span>{t("accounts.archive")}</span>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
        </label>
      )}

      {/* Archive rather than delete: a deleted account would orphan every transaction that
          referenced it, and those transactions are the actual record. */}
      {account && <p className={HINT}>{t("accounts.deleteBlocked")}</p>}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button variant="primary" block layoutClassName="mt-4" onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </Sheet>
  );
}
