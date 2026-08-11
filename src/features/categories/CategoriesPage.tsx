import type { Category } from "@shared/schema";
import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { newId, put } from "~/db/mutations";
import { useCategories, useCategoryTransactionCount, useTransactions } from "~/db/queries";
import { Chip, Field, FieldGroup, IconChip, Segmented, Sheet } from "~/ui";
import { Button } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { LIST, PAGE, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";

const ICON_CHOICES = [
  "🛒", "✈️", "🏠", "🚗", "⚽", "👴", "👶", "🍽️", "👕", "🎁",
  "💊", "💻", "📄", "📦", "🐾", "📚", "🔌", "🎓", "🧾", "💼",
  "🤝", "⚖️", "🎬", "💰", "📥", "🏷️", "❓", "☕", "🚇", "⛽",
];
const COLOR_CHOICES = [
  "#E5484D", "#F76B15", "#FFB224", "#30A46C", "#12A594",
  "#0091FF", "#3E63DD", "#8E4EC6", "#E93D82", "#6E6E76",
];

export function CategoriesPage() {
  const { t } = useApp();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const categories = useCategories(kind, true);
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  return (
    <div className={PAGE}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className={cn(PAGE_TITLE, "mb-0")}>{t("categories.title")}</h1>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("categories.add")}
        </Button>
      </div>

      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "expense", label: t("categories.expenses") },
          { value: "income", label: t("categories.income") },
        ]}
      />

      {/* Worth saying out loud: the two of you may read the UI in different languages, but
          category names are one shared list. */}
      <p className="mb-4 mt-2 text-xs text-muted-foreground">{t("categories.shared")}</p>

      <div className={LIST}>
        {categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            onClick={() => setEditing(category)}
          />
        ))}
      </div>

      {editing && (
        <CategorySheet
          category={editing === "new" ? undefined : editing}
          defaultKind={kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryRow({ category, onClick }: { category: Category; onClick: () => void }) {
  const { t } = useApp();
  const count = useCategoryTransactionCount(category.id);

  return (
    <button
      type="button"
      className={cn(ROW, "hover:bg-accent active:bg-accent")}
      onClick={onClick}
    >
      <IconChip icon={category.icon} color={category.archived ? undefined : category.color} />
      <span className="min-w-0 flex-1">
        <span className={cn(ROW_TITLE, category.archived && "text-muted-foreground")}>
          {category.name}
        </span>
        <span className={ROW_SUB}>
          {t("history.count", { count })}
          {category.archived === 1 ? ` · ${t("accounts.archived")}` : ""}
        </span>
      </span>
    </button>
  );
}

function CategorySheet({
  category,
  defaultKind,
  onClose,
}: {
  category?: Category | undefined;
  defaultKind: "expense" | "income";
  onClose: () => void;
}) {
  const { t, me } = useApp();
  const siblings = useCategories(category?.kind ?? defaultKind, true);
  const transactions = useTransactions();

  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "🏷️");
  const [color, setColor] = useState(category?.color ?? "#6E6E76");
  const [archived, setArchived] = useState(category?.archived === 1);
  const [mergeTarget, setMergeTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const kind = category?.kind ?? defaultKind;

  async function save() {
    if (!name.trim()) {
      setError(t("categories.name"));
      return;
    }
    await put(
      "categories",
      {
        id: category?.id ?? newId(),
        kind,
        name: name.trim(),
        parent_id: category?.parent_id ?? null,
        icon,
        color,
        archived: archived ? 1 : 0,
        sort_order: category?.sort_order ?? siblings.length + 1,
      } as never,
      me,
    );
    onClose();
  }

  /**
   * Merge moves every transaction across, then archives the emptied category.
   *
   * Rewriting history rather than aliasing means past reports stay consistent with present
   * ones — an alias would leave the old name showing in a report run over an old month.
   */
  async function merge() {
    if (!category || !mergeTarget) return;
    const affected = transactions.filter((tx) => tx.category_id === category.id);
    for (const tx of affected) {
      await put("transactions", { ...tx, category_id: mergeTarget } as never, me);
    }
    await put("categories", { ...category, archived: 1 } as never, me);
    onClose();
  }

  return (
    <Sheet title={category ? t("categories.edit") : t("categories.add")} onClose={onClose}>
      <Field label={t("categories.name")}>
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
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
              // eslint-disable-next-line no-restricted-syntax -- dynamic data colour
              style={{ background: option }}
            />
          ))}
        </div>
      </FieldGroup>

      {category && (
        <>
          <label className="mt-3 flex min-h-11 items-center justify-between gap-3">
            <span>{t("categories.archive")}</span>
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => setArchived(event.target.checked)}
            />
          </label>

          <Field label={t("categories.merge")}>
            <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
              <option value="">{t("common.none")}</option>
              {siblings
                .filter((c) => c.id !== category.id && c.archived === 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>

          {mergeTarget && (
            <Button variant="danger" block onClick={() => void merge()}>
              {t("categories.merge")}
            </Button>
          )}
        </>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button variant="primary" block layoutClassName="mt-4" onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </Sheet>
  );
}
