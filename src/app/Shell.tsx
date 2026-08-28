import type { TxKind } from "@shared/money";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "~/app/AppContext";
import { cn } from "~/lib/cn";
import { useRouter, type RouteName } from "~/app/router";
import { EntrySheet } from "~/features/entry/EntrySheet";
import { createPressGesture } from "~/lib/press-gesture";
import {
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  HomeIcon,
  PlusIcon,
  ReportsIcon,
  SettingsIcon,
} from "~/ui/icons";
import { useLastTransaction, useRepeatLast } from "~/features/entry/useRepeatLast";
import { Toast, type ToastSpec } from "~/ui";
import { IconButton } from "~/ui/Button";
import { PullToRefresh } from "~/ui/PullToRefresh";
import { requestSync } from "~/db/sync-client";
import { SyncPill } from "~/ui/SyncPill";

/**
 * App chrome: a bottom tab bar on mobile, a sidebar on desktop, and the entry sheet.
 *
 * The centre action is deliberately the largest target on screen and sits in the natural
 * thumb arc. Long-pressing it repeats the last transaction, which covers the roughly one
 * third of entries that are the same thing again.
 */

interface Tab {
  name: RouteName;
  path: string;
  Icon: (props: { size?: number }) => React.ReactElement;
  labelKey: "nav.home" | "nav.history" | "nav.reports" | "nav.settings";
}

const LEFT_TABS: Tab[] = [
  { name: "home", path: "/", Icon: HomeIcon, labelKey: "nav.home" },
  { name: "history", path: "/history", Icon: HistoryIcon, labelKey: "nav.history" },
];

const RIGHT_TABS: Tab[] = [
  { name: "reports", path: "/reports", Icon: ReportsIcon, labelKey: "nav.reports" },
  { name: "settings", path: "/settings", Icon: SettingsIcon, labelKey: "nav.settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useApp();
  const { route, navigate } = useRouter();
  const [entryOpen, setEntryOpen] = useState(false);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  /**
   * Privacy mode, for recording the screen over real data: everything marked `sensitive` blurs.
   *
   * One attribute on <html> rather than a context, because the consumers are leaf spans all over
   * the tree and CSS reaches all of them for free. Deliberately not persisted: a mode whose job
   * is "while the camera runs" should never survive into tomorrow's breakfast glance.
   */
  const [privacy, setPrivacy] = useState(false);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-privacy", privacy);
    return () => document.documentElement.removeAttribute("data-privacy");
  }, [privacy]);

  const lastTransaction = useLastTransaction();
  const repeatLast = useRepeatLast();

  // Tap opens the entry sheet; holding repeats the last transaction. The gesture lives in a
  // pure state machine (src/lib/press-gesture.ts) because the inline version shipped a
  // deadlock — it armed the hold timer only when a previous transaction existed, then opened
  // the sheet only if that timer had been armed, so on an empty ledger the button did nothing.
  /** Set by the e/i/t shortcuts so the sheet opens on the right kind. */
  const [entryKind, setEntryKind] = useState<TxKind | undefined>(undefined);

  const pressGesture = useMemo(
    () =>
      createPressGesture({
        onTap: () => setEntryOpen(true),
        // Undefined when there is nothing to repeat. A tap still works either way — that is
        // the invariant the old code broke.
        onLongPress: lastTransaction ? () => void repeatLast() : undefined,
      }),
    [lastTransaction, repeatLast],
  );

  /*
   * Desktop shortcuts. N opens the sheet; E, I and T open it on expense, income or transfer.
   *
   * Keyed on `event.code`, which is the *physical* key, not `event.key`, which is the character the
   * current layout produces. On a Russian layout the key printed "E" emits "у", so a check against
   * "e" would leave the shortcuts dead for the people this app was built for. The mnemonic stays
   * English because that is what is printed on the keycap.
   */
  useEffect(() => {
    const KINDS: Record<string, TxKind> = {
      KeyE: "expense",
      KeyI: "income",
      KeyT: "transfer",
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      // While any sheet is open it owns the keyboard — the entry sheet reads digits and operators,
      // and a stray "t" must not reset the form the user is halfway through.
      if (document.querySelector('[role="dialog"]')) return;

      const kind = KINDS[event.code];
      if (kind) {
        event.preventDefault();
        setEntryKind(kind);
        setEntryOpen(true);
        return;
      }

      if (event.code === "KeyN") {
        event.preventDefault();
        setEntryKind(undefined);
        setEntryOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const renderTab = (tab: Tab) => (
    <button
      key={tab.name}
      type="button"
      className={cn(
        "flex min-h-11 flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] font-medium",
        "text-muted-foreground aria-[current=page]:text-foreground",
        // Sidebar form: a labelled row, like every desktop nav.
        "min-[900px]:flex-row min-[900px]:justify-start min-[900px]:gap-3 min-[900px]:px-3",
        "min-[900px]:py-2.5 min-[900px]:text-[15px] min-[900px]:aria-[current=page]:bg-accent",
      )}
      aria-current={route.name === tab.name ? "page" : undefined}
      onClick={() => navigate(tab.path)}
    >
      <span className="grid h-[22px] place-items-center">
        <tab.Icon />
      </span>
      {t(tab.labelKey)}
    </button>
  );

  return (
    <div className="flex min-h-dvh flex-col min-[900px]:flex-row">
      {/*
        Bottom tab bar on the phone, sidebar on desktop — one nav, two arrangements. Translucent
        with blur only where content passes beneath it: a backdrop-filter on the sticky sidebar made
        the browser skip repaints and left the labels ghosted down the page (the 1.3.x bug).
      */}
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 items-end gap-0.5 border-t border-border",
          "bg-background/90 px-1 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md",
          "min-[900px]:sticky min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:top-0",
          "min-[900px]:flex min-[900px]:h-dvh min-[900px]:w-[232px] min-[900px]:flex-none",
          "min-[900px]:flex-col min-[900px]:items-stretch min-[900px]:justify-start",
          "min-[900px]:border-r min-[900px]:border-t-0 min-[900px]:bg-background",
          "min-[900px]:px-3 min-[900px]:py-6 min-[900px]:backdrop-blur-none",
        )}
        aria-label={t("app.name")}
      >
        {LEFT_TABS.map(renderTab)}

        <button
          type="button"
          className={cn(
            // A raised circle on the phone, deliberately larger than the tabs around it.
            "mx-auto grid size-[54px] place-items-center rounded-full bg-primary text-primary-foreground",
            "shadow-lg shadow-primary/30 active:scale-95",
            // The sidebar form: first in the list, shaped like its neighbours, label shown.
            "min-[900px]:order-first min-[900px]:mx-0 min-[900px]:mb-3 min-[900px]:flex min-[900px]:h-auto",
            "min-[900px]:w-auto min-[900px]:items-center min-[900px]:justify-start min-[900px]:gap-3",
            "min-[900px]:rounded-lg min-[900px]:px-3 min-[900px]:py-2.5 min-[900px]:text-[15px]",
            "min-[900px]:font-semibold min-[900px]:shadow-none",
          )}
          aria-label={t("nav.add")}
          /* Its own press animation lives in `active:scale-95` above, and the gesture machine owns
             what a press here means. The app-wide flash would animate the same transform. */
          data-press-flash="off"
          // The only place the shortcuts are discoverable, and it costs nothing.
          title={t("nav.addShortcuts")}
          onPointerDown={() => pressGesture.down()}
          onPointerUp={() => pressGesture.up()}
          onPointerLeave={() => pressGesture.cancel()}
          onPointerCancel={() => pressGesture.cancel()}
          // Keyboard and assistive tech never produce pointer events, so the gesture layer
          // would leave the primary action unreachable without this.
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setEntryOpen(true);
            }
          }}
        >
          <PlusIcon />
          {/* Hidden on the phone, where the button is a round FAB and the icon is the whole point.
              In the desktop sidebar every other item is labelled, and a lone glyph in a wide
              rectangle reads as something that failed to render. */}
          <span className="hidden min-[900px]:inline">{t("nav.add")}</span>
        </button>

        {RIGHT_TABS.map(renderTab)}
      </nav>

      <main className="min-w-0 flex-1 pb-[calc(88px+env(safe-area-inset-bottom))] min-[900px]:pb-6">
        <PullToRefresh onRefresh={requestSync}>
          <header className="sticky top-0 z-[5] flex items-center justify-between gap-3 bg-background/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur-md">
            <h1 className="m-0 text-lg font-semibold">{t("app.name")}</h1>
            <span className="flex items-center gap-1">
              <IconButton
                label={privacy ? t("app.privacyOff") : t("app.privacyOn")}
                aria-pressed={privacy}
                onClick={() => setPrivacy((current) => !current)}
              >
                {privacy ? <EyeOffIcon /> : <EyeIcon />}
              </IconButton>
              <SyncPill />
            </span>
          </header>
          {children}
        </PullToRefresh>
      </main>

      {entryOpen && (
        <EntrySheet
          initialKind={entryKind}
          // Adding while looking at one account's transactions almost always means that
          // account. The filter lives in the URL, so it is readable from here.
          contextAccountId={route.name === "history" ? route.query.get("account") : null}
          onClose={() => setEntryOpen(false)}
          onSaved={(spec) => {
            setEntryOpen(false);
            if (spec) setToast(spec);
          }}
        />
      )}

      {toast && <Toast spec={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
