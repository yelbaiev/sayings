import { SUPPORTED_LOCALES, type Currency, type Locale } from "@shared/currency";
import { useEffect, useState } from "react";
import { useApp } from "~/app/AppContext";
import { Link, useRouter } from "~/app/router";
import { resetLocalMirror, setDevicePrefs } from "~/db/dexie";
import { put } from "~/db/mutations";
import { useAccounts, useMembers, useTransactionCount } from "~/db/queries";
import { requestSync } from "~/db/sync-client";
import { LOCALE_LABELS } from "~/i18n";
import { exportEverything } from "~/features/settings/export";
import { authLogout, createInviteLink, getVersion, type VersionInfo } from "~/lib/api";
import { hardReload } from "~/lib/hard-reload";
import { formatBytes, formatDate, formatRelativeTime } from "~/lib/format";
import { Avatar, Field, FieldGroup, Segmented, Toast, type ToastSpec } from "~/ui";
import { BaseChangeSheet } from "./BaseChangeSheet";
import { BaseCurrencyField, EnabledCurrenciesField } from "./CurrencyPicker";
import { Button } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { CARD, HINT, LIST, PAGE, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE, SECTION_TITLE } from "~/ui/recipes";
import type { Member } from "@shared/schema";

/* Injected from package.json at build time, so it cannot drift from the released version. */
const APP_VERSION = __APP_VERSION__;



export function SettingsPage() {
  const { t, me, locale, setLocale, theme, setTheme, baseCurrency, enabledCurrencies, saveCurrencies } =
    useApp();
  const { navigate } = useRouter();
  const members = useMembers();
  const accounts = useAccounts();
  const transactionCount = useTransactionCount();

  const [displayName, setDisplayName] = useState(me.display_name);
  const [storage, setStorage] = useState<number | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  /** Latches: the page is about to be replaced, so it never needs resetting. */
  const [reloading, setReloading] = useState(false);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  /*
   * Held locally so the chips respond to a tap immediately. The setting lives on the server and is
   * not in the local mirror, so there is no live query to re-render from — and waiting for a round
   * trip before the chip changes state makes the control feel broken on a slow connection.
   */
  const [enabled, setEnabled] = useState<Currency[]>(enabledCurrencies);
  /** The base being confirmed. Null when no change is pending. */
  const [pendingBase, setPendingBase] = useState<Currency | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    // Shows how much of this device the mirror is using. Reassuring rather than alarming —
    // five years of history is a few megabytes.
    void navigator.storage?.estimate?.().then((estimate) => setStorage(estimate.usage ?? null));
  }, []);

  useEffect(() => {
    void fetch("/api/backups/latest")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { created_at?: number } | null) => setLastBackup(data?.created_at ?? null))
      .catch(() => setLastBackup(null));
  }, []);

  /** Stored on the member row, so it follows the person to their other devices. */
  async function saveDefaultAccount(accountId: string | null) {
    const current = members.find((m) => m.id === me.id);
    if (!current) return;
    await put<Member>("members", { ...current, default_account_id: accountId }, me);
  }

  async function saveName() {
    const current = members.find((m) => m.id === me.id);
    if (!current || displayName.trim() === current.display_name) return;
    await put<Member>("members", { ...current, display_name: displayName.trim() }, me);
  }

  /**
   * Currencies that cannot be turned off, because something still denominated in one would stop
   * being convertible. Read from the accounts rather than assumed, so archiving the last euro
   * account genuinely frees the euro.
   */
  const currenciesInUse = new Set(accounts.map((account) => account.currency));

  async function saveEnabled(next: Currency[]) {
    const previous = enabled;
    setEnabled(next);
    try {
      await saveCurrencies(baseCurrency, next);
      setToast({ message: t("settings.currencySaved") });
    } catch {
      // Put the chips back rather than leaving the UI claiming something the server did not accept.
      setEnabled(previous);
      setToast({ message: t("settings.currencyFailed") });
    }
  }

  const isIos =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isInstalled =
    typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>{t("settings.title")}</h1>

      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("settings.household")}</h2>
        <div className={cn(CARD, "flex flex-col gap-4")}>
          <Field label={t("settings.displayName")}>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              onBlur={() => void saveName()}
            />
          </Field>

          <Field label={t("settings.defaultAccount")} hint={t("settings.defaultAccountHint")}>
            <select
              value={me.default_account_id ?? ""}
              onChange={(event) => void saveDefaultAccount(event.target.value || null)}
            >
              <option value="">{t("settings.noDefault")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("settings.language")}>
            <select
              value={locale}
              onChange={(event) => void setLocale(event.target.value as Locale)}
            >
              {SUPPORTED_LOCALES.map((option) => (
                <option key={option} value={option}>
                  {LOCALE_LABELS[option]}
                </option>
              ))}
            </select>
          </Field>

          <FieldGroup label={t("settings.theme")}>
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[
                { value: "system", label: t("settings.theme.system") },
                { value: "light", label: t("settings.theme.light") },
                { value: "dark", label: t("settings.theme.dark") },
              ]}
            />
          </FieldGroup>
        </div>
      </section>

      {toast && <Toast spec={toast} onDismiss={() => setToast(null)} />}

      {pendingBase && (
        <BaseChangeSheet
          next={pendingBase}
          transactionCount={transactionCount}
          onClose={() => setPendingBase(null)}
          onDone={(message) => {
            setPendingBase(null);
            setToast({ message });
            /*
             * A full reload rather than a state update. The re-pricing rewrote a column on every
             * transaction and rewrote the rate table; the local mirror holds copies of both, and every
             * report on screen was computed from the old ones. Re-reading is the only honest way back
             * to a consistent view.
             */
            hardReload();
          }}
        />
      )}

      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("settings.currencies")}</h2>
        <div className={cn(CARD, "flex flex-col gap-4")}>
          <BaseCurrencyField
            value={baseCurrency}
            hint={
              transactionCount > 0
                ? t("settings.baseCurrencyLocked")
                : t("settings.baseCurrencyHint")
            }
            onChange={(next) => {
              if (next === baseCurrency) return;
              /*
               * With history, this is a re-pricing operation rather than a setting —
               * `base_amount_minor` is denormalised onto every transaction — so it goes through a
               * confirmation that says what changes and what does not. With nothing recorded there is
               * nothing to re-price and it is an ordinary save.
               */
              if (transactionCount > 0) {
                setPendingBase(next);
                return;
              }
              // The base is always usable for an account, so choosing it also enables it.
              const withBase = enabled.includes(next) ? enabled : [...enabled, next].sort();
              setEnabled(withBase);
              void saveCurrencies(next, withBase);
            }}
          />
          <EnabledCurrenciesField
            base={baseCurrency}
            value={enabled}
            locked={currenciesInUse}
            onChange={(next) => void saveEnabled(next)}
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("settings.members")}</h2>
        <div className={LIST}>
          {members.map((member) => (
            <div key={member.id} className={ROW}>
              <Avatar name={member.display_name} color={member.avatar_color} />
              <span className="min-w-0 flex-1">
                <span className={ROW_TITLE}>{member.display_name}</span>
                {/* A passkey member's email is a synthetic placeholder — showing it would read
                    as a bug. The name is the identity here. */}
                {!member.email.endsWith("@local.invalid") && (
                  <span className={ROW_SUB}>{member.email}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {me.role === "owner" && (
          <div className="mt-2">
            <Button
              size="sm"
              disabled={inviting}
              onClick={() => {
                setInviting(true);
                void createInviteLink()
                  .then(async ({ path, expiresInHours }) => {
                    const url = `${window.location.origin}${path}`;
                    /*
                     * The share sheet where it exists (a phone — and the link travels by whatever
                     * messenger the household already uses), the clipboard elsewhere. The link is
                     * one-time and 48h-limited, so a stale chat message is inert.
                     */
                    if (navigator.share) {
                      await navigator.share({ url }).catch(() => undefined);
                    } else {
                      await navigator.clipboard?.writeText(url);
                    }
                    setToast({
                      message: t("settings.inviteReady", { hours: expiresInHours }),
                    });
                  })
                  .catch(() => setToast({ message: t("settings.inviteFailed") }))
                  .finally(() => setInviting(false));
              }}
            >
              {t("settings.invite")}
            </Button>
            <p className={HINT}>{t("settings.inviteHint")}</p>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("settings.manage")}</h2>
        <div className={LIST}>
          {(
            [
              ["/accounts", t("accounts.title")],
              ["/categories", t("categories.title")],
              ["/budgets", t("budgets.title")],
              ["/recurring", t("recurring.title")],
              ["/import", t("import.title")],
            ] as const
          ).map(([to, label]) => (
            <Link key={to} to={to} className={cn(ROW, "hover:bg-accent active:bg-accent")}>
              <span className="min-w-0 flex-1 font-medium">{label}</span>
              <span className="shrink-0 text-lg leading-none text-muted-foreground" aria-hidden>
                ›
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* The section this whole project exists for. */}
      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("settings.data")}</h2>
        <div className={CARD}>
          <Button
            variant="primary"
            block
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              void exportEverything(locale).finally(() => setExporting(false));
            }}
          >
            {t("settings.export")}
          </Button>
          <p className={HINT}>{t("settings.exportHint")}</p>

          <p className="mt-3 text-xs text-muted-foreground">
            {lastBackup
              ? t("settings.lastBackup", { time: formatRelativeTime(lastBackup, locale) })
              : t("settings.noBackupYet")}
          </p>

          <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{t("history.count", { count: transactionCount })}</span>
            {storage !== null && (
              <span>{t("settings.storageUsed", { size: formatBytes(storage, locale) })}</span>
            )}
          </div>

          <Button
            block
            layoutClassName="mt-3"
            onClick={() => {
              // Safe by construction: the server is authoritative and the outbox is kept,
              // so nothing unsent is discarded.
              void resetLocalMirror().then(() => requestSync());
            }}
          >
            {t("settings.resync")}
          </Button>
          <p className={HINT}>{t("settings.resyncHint")}</p>

          {/* Sits under resync on purpose: the two are easy to confuse and the distinction matters.
              Resync rebuilds the *data* from the server; this replaces the *app*. Nothing here goes
              near IndexedDB, which holds the outbox as well as the mirror. */}
          <Button
            block
            disabled={reloading}
            layoutClassName="mt-3"
            onClick={() => {
              setReloading(true);
              void hardReload();
            }}
          >
            {t("settings.hardReload")}
          </Button>
          <p className={HINT}>{t("settings.hardReloadHint")}</p>

          <Button
            block
            layoutClassName="mt-3"
            onClick={() => {
              // Access-fronted sessions ignore this (the JWT re-admits immediately); passkey
              // sessions land on the login screen, which is the point.
              void authLogout().finally(() => window.location.replace("/"));
            }}
          >
            {t("settings.logout")}
          </Button>
        </div>
      </section>

      {/* iOS evicts IndexedDB for sites that are not installed, so this is not cosmetic. */}
      {!isInstalled && (
        <section className="mb-6">
          <div className={CARD}>
            <strong>{t("settings.install")}</strong>
            <p className="mt-1.5 text-xs text-muted-foreground">{t("settings.installHint")}</p>
            {isIos && <p className="mt-1.5 text-xs">{t("settings.installIos")}</p>}
          </div>
        </section>
      )}

      {/* Sends the reader back to Home rather than opening the intro here: its last panel opens the
          entry sheet, and the tour reads oddly if it starts from the settings screen. */}
      <Button
        variant="ghost"
        size="sm"
        layoutClassName="mt-2"
        onClick={() => {
          void setDevicePrefs({ introSeen: false }).then(() => navigate("/"));
        }}
      >
        {t("settings.showIntro")}
      </Button>

      <VersionRow />
    </div>
  );
}

/**
 * The installed version, and whether a newer one exists upstream.
 *
 * The check itself runs nightly in the Worker; this only reads what it stored, so opening Settings
 * makes no outbound request. Renders the plain version and nothing else until the answer arrives —
 * a "checking…" state would flash for one local database read and tell nobody anything.
 */
function VersionRow() {
  const { t, locale } = useApp();
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    // A failure here is not worth surfacing: the version number below is still correct, and an
    // error about an update check would be noise on a screen about backups and exports.
    getVersion()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const version = info?.current ?? APP_VERSION;

  if (!info?.updateAvailable || !info.latest) {
    return (
      <p className="selectable text-xs text-muted-foreground">
        {t("settings.version", { version })}
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-primary/40 bg-secondary p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className="text-xs">
          {t("settings.updateAvailable", { tag: info.latest.tag })}
        </strong>
        <span className="text-xs text-muted-foreground">
          <span className="selectable">{t("settings.version", { version })}</span>
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{t("settings.updateHow")}</p>
      <p className="mt-2 text-xs">
        <a
          className="underline underline-offset-2"
          href={info.latest.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("settings.updateNotes")}
          {info.latest.published_at
            ? ` · ${formatDate(info.latest.published_at.slice(0, 10), locale)}`
            : ""}
        </a>
      </p>
    </div>
  );
}
