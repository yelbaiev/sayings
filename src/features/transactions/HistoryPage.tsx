import type { Currency } from "@shared/currency";
import { signedMinor } from "@shared/money";
import type { Transaction } from "@shared/schema";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "~/app/AppContext";
import { cn } from "~/lib/cn";
import { Button } from "~/ui/Button";
import { CARD, LIST, PAGE, PAGE_TITLE, ROW_SUB, ROW_TITLE } from "~/ui/recipes";
import { useRouter } from "~/app/router";
import { useHideOnScrollDown } from "~/lib/useScrollDirection";
import { newId, put, remove, restore } from "~/db/mutations";
import {
  useAccountBalance,
  useAccounts,
  useCategories,
  useLookups,
  useMembers,
  useTransactions,
} from "~/db/queries";
import { EntrySheet } from "~/features/entry/EntrySheet";
import { formatDayHeading, todayIso } from "~/lib/format";
import { Amount, Chip, EmptyState, IconChip, SwipeRow, Toast, type ToastSpec } from "~/ui";
import { TransactionRow } from "./TransactionRow";

/**
 * Full history: grouped by day, filterable, searchable, and virtualised.
 *
 * Virtualisation is not optional here. Five years is ~35k rows, and rendering that as real
 * DOM locks up mobile Safari for seconds — the list has to render only what is on screen.
 */

type Row =
  | { kind: "heading"; date: string; total: number }
  | { kind: "transaction"; transaction: Transaction };

export function HistoryPage() {
  const { t, me, locale, baseCurrency } = useApp();
  const accounts = useAccounts(true);
  const categories = useCategories(undefined, true);
  const members = useMembers();
  const lookups = useLookups();
  const { route, navigate } = useRouter();
  const chromeHidden = useHideOnScrollDown();

  const [search, setSearch] = useState("");

  /**
   * The URL is the single source of truth for this filter — derived, never copied into state.
   *
   * It used to be seeded into useState once on mount, with writes keeping the two in sync. But the
   * page stays mounted while the URL changes under it (tapping the History tab navigates to a bare
   * /history), and the copy kept the old filter: the list stayed filtered to one card while the
   * shell — which reads the URL to preselect that card in the entry sheet — saw no filter at all.
   * The visible list and the preselected account disagreeing is the "card memory" bug, twice now.
   *
   * Replaces rather than pushes: changing a filter should not stack history entries to back out of.
   */
  const accountId = route.query.get("account") ?? undefined;
  const setAccountId = (next: string | undefined) => {
    navigate(next ? `/history?account=${encodeURIComponent(next)}` : "/history", { replace: true });
  };
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [memberId, setMemberId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  /**
   * The 612 imported Saldo rows all sit on the 1st of their month, so thirty of them stack on a
   * single day and bury real entries. Hidden by default and one tap away — they are summary
   * figures for Reports, not events you scroll through.
   */
  const [showImported, setShowImported] = useState(false);

  const transactions = useTransactions({
    ...(search ? { search } : {}),
    ...(accountId ? { accountId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(memberId ? { memberId } : {}),
  });

  const hasFilters = Boolean(search || accountId || categoryId || memberId);
  /* What the chosen card holds right now. Null unless one is chosen — see useAccountBalance. */
  const selected = useAccountBalance(accountId);

  // Imported rows live on accounts excluded from totals, which is what marks them as synthetic.
  const importedAccountIds = useMemo(
    () => new Set(accounts.filter((a) => a.exclude_from_totals === 1).map((a) => a.id)),
    [accounts],
  );

  const visible = useMemo(() => {
    if (showImported || importedAccountIds.size === 0) return transactions;
    return transactions.filter((tx) => !importedAccountIds.has(tx.account_id));
  }, [transactions, showImported, importedAccountIds]);

  const hiddenCount = transactions.length - visible.length;

  // Flattened into a single list of headings and rows, because a virtualiser needs one
  // uniform index space — nested day groups cannot be windowed.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let currentDate = "";
    let dayTotal = 0;
    let headingIndex = -1;

    for (const tx of visible) {
      if (tx.occurred_on !== currentDate) {
        if (headingIndex >= 0) (out[headingIndex] as { total: number }).total = dayTotal;
        currentDate = tx.occurred_on;
        dayTotal = 0;
        headingIndex = out.length;
        out.push({ kind: "heading", date: currentDate, total: 0 });
      }
      dayTotal += signedMinor(tx.kind, tx.base_amount_minor);
      out.push({ kind: "transaction", transaction: tx });
    }
    if (headingIndex >= 0) (out[headingIndex] as { total: number }).total = dayTotal;
    return out;
  }, [visible]);

  const listRef = useRef<HTMLDivElement>(null);
  /**
   * Distance from the top of the document to the list, which the window virtualiser needs to
   * place rows. Measured into state rather than read from the ref during render — and re-measured
   * when the filters collapse, because that changes the offset by the height of the chrome.
   */
  const [listTop, setListTop] = useState(0);
  // Virtualisation is not optional here: 35k rows of real DOM locks up mobile Safari.
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    // Matched to the converted heights (heading 40px, row 60px). When these drift from reality
    // the virtualiser corrects each row as it measures it, and the corrections are the "jerks".
    estimateSize: (index) => (rows[index]?.kind === "heading" ? 40 : 60),
    overscan: 12,
    scrollMargin: listTop,
  });

  /*
   * A layout effect, not a plain one: the virtualiser positions every row relative to this
   * offset, so measuring after paint leaves one frame drawn against a stale scrollMargin. At
   * 60fps that single frame is visible as a flicker when the filters collapse.
   */
  useLayoutEffect(() => {
    const measure = () => setListTop(listRef.current?.offsetTop ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // chromeHidden is a dependency because collapsing the filters moves the list up.
  }, [chromeHidden, rows.length]);

  async function handleDelete(tx: Transaction) {
    const previous = await remove("transactions", tx.id, me);
    setToast({
      message: t("history.deleted"),
      action: previous
        ? { label: t("entry.undo"), onClick: () => void restore("transactions", previous, me) }
        : undefined,
    });
  }

  async function handleDuplicate(tx: Transaction) {
    const id = newId();
    await put(
      "transactions",
      {
        ...tx,
        id,
        occurred_on: todayIso(),
        import_hash: null,
        receipt_key: null,
        // The copy is the duplicator's entry; the original keeps its own author.
        created_by: me.id,
      } as never,
      me,
    );
    // No toast: the copy lands at the top of today, which is feedback enough, and deleting it
    // is one hold away. The undo cloud retired once deletion got its own safeguard.
  }

  /** Bulk recategorise — the tool for cleaning up a large "Uncategorised" block after import. */
  async function bulkRecategorise(targetId: string) {
    const target = categories.find((c) => c.id === targetId);
    const affected = transactions.filter((tx) => selection.has(tx.id));
    for (const tx of affected) {
      await put("transactions", { ...tx, category_id: targetId } as never, me);
    }
    setSelection(new Set());
    setToast({
      message: t("history.bulkDone", { count: affected.length, category: target?.name ?? "" }),
    });
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>{t("history.title")}</h1>

      <div className={chromeHidden ? "collapsible collapsible--hidden" : "collapsible"}>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("history.search")}
        className="mb-3"
      />

      <div className="mb-2 flex flex-wrap gap-2 [&>select]:min-w-0 [&>select]:flex-auto">
        <select
          value={accountId ?? ""}
          onChange={(event) => setAccountId(event.target.value || undefined)}
          aria-label={t("history.filterAccount")}
          className="w-auto min-w-[120px]"
        >
          <option value="">{t("history.filterAccount")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={categoryId ?? ""}
          onChange={(event) => setCategoryId(event.target.value || undefined)}
          aria-label={t("history.filterCategory")}
          className="w-auto min-w-[120px]"
        >
          <option value="">{t("history.filterCategory")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={memberId ?? ""}
          onChange={(event) => setMemberId(event.target.value || undefined)}
          aria-label={t("history.filterMember")}
          className="w-auto min-w-[100px]"
        >
          <option value="">{t("history.filterMember")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>

        {hiddenCount > 0 && (
          <Chip active={showImported} onClick={() => setShowImported((v) => !v)}>
            {showImported ? t("history.importedHidden") : t("history.showImported")}
          </Chip>
        )}

        {hasFilters && (
          <Chip
            onClick={() => {
              setSearch("");
              setAccountId(undefined);
              setCategoryId(undefined);
              setMemberId(undefined);
            }}
          >
            {t("history.clearFilters")}
          </Chip>
        )}
      </div>

      </div>

      {/*
        The chosen card, with what it holds. Filtering history to one account is how the app is
        used to answer "what is on this card" — the list below answers where the money went, and
        without this the figure that prompted the question is on another screen.

        Deliberately not a running balance down the rows: that is a different, much heavier claim
        (every row needs the balance *after* it, in date order, including rows filtered out of
        view) and it is not what was asked for.
      */}
      {selected && (
        <div data-slot="account-balance" className={cn(CARD, "mb-2 flex items-center gap-2.5")}>
          <IconChip icon={selected.account.icon} color={selected.account.color} />
          <span className="min-w-0 flex-1">
            <span className={ROW_TITLE}>{selected.account.name}</span>
            <span className={ROW_SUB}>{t("accounts.balance")}</span>
          </span>
          <Amount
            minor={selected.native}
            currency={selected.account.currency as Currency}
            tone={selected.native < 0 ? "expense" : "neutral"}
            cents
          />
        </div>
      )}

      <div className="mb-2 text-xs text-muted-foreground">
        <span>{t("history.count", { count: visible.length })}</span>
      </div>

      {selection.size > 0 && (
        <div className={cn(CARD, "mb-2 flex flex-wrap items-center gap-2")}>
          <span className="text-xs">{t("history.selected", { count: selection.size })}</span>
          <select
            defaultValue=""
            onChange={(event) => event.target.value && void bulkRecategorise(event.target.value)}
            aria-label={t("history.recategorise")}
            className="w-auto"
          >
            <option value="">{t("history.recategorise")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={() => setSelection(new Set())}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="🧾"
          message={hasFilters ? t("history.emptyFiltered") : t("history.empty")}
        />
      ) : (
        <div ref={listRef} className={LIST}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start - listTop}px)`,
                  }}
                >
                  {row.kind === "heading" ? (
                    <div className="flex items-baseline justify-between gap-3 px-3 pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                      <span>{formatDayHeading(row.date, locale)}</span>
                      <Amount
                        minor={row.total}
                        currency={baseCurrency}
                        tone="muted"
                        signed
                      />
                    </div>
                  ) : (
                    <SwipeRow
                      left={{
                        label: t("history.delete"),
                        tone: "danger",
                        onAction: () => void handleDelete(row.transaction),
                      }}
                      right={{
                        label: t("history.duplicate"),
                        tone: "neutral",
                        onAction: () => void handleDuplicate(row.transaction),
                      }}
                    >
                      <TransactionRow
                        transaction={row.transaction}
                        lookups={lookups}
                        selected={selection.has(row.transaction.id)}
                        onClick={() => {
                          // Once a selection is open, tapping toggles rather than edits, so
                          // bulk cleanup does not keep opening the editor.
                          if (selection.size > 0) {
                            const next = new Set(selection);
                            if (next.has(row.transaction.id)) next.delete(row.transaction.id);
                            else next.add(row.transaction.id);
                            setSelection(next);
                          } else {
                            setEditing(row.transaction);
                          }
                        }}
                        // Long press is how bulk selection starts. It replaces a button below
                        // the list that read "change category" but actually meant "begin
                        // selecting", and seeded the selection with an arbitrary first row.
                        onLongPress={
                          selection.size === 0
                            ? () => setSelection(new Set([row.transaction.id]))
                            : undefined
                        }
                      />
                    </SwipeRow>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <EntrySheet
          editing={editing}
          contextAccountId={accountId ?? null}
          onClose={() => setEditing(undefined)}
          onSaved={(spec) => {
            setEditing(undefined);
            if (spec) setToast(spec);
          }}
        />
      )}

      {toast && <Toast spec={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
