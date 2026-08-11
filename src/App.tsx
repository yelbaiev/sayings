import { isLocale } from "@shared/currency";
import { useEffect, useState } from "react";
import { AppProvider, type Me } from "~/app/AppContext";
import { Button } from "~/ui/Button";
import { CurrencySetup } from "~/app/CurrencySetup";
import { RouterProvider, useRouter } from "~/app/router";
import { ClaimScreen, JoinScreen, LoginScreen } from "~/app/AuthScreens";
import { Shell } from "~/app/Shell";
import { startSync } from "~/db/sync-client";
import { AccountsPage } from "~/features/accounts/AccountsPage";
import { BudgetsPage } from "~/features/budgets/BudgetsPage";
import { CategoriesPage } from "~/features/categories/CategoriesPage";
import { HomePage } from "~/features/home/HomePage";
import { ReportsPage } from "~/features/reports/ReportsPage";
import { SettingsPage } from "~/features/settings/SettingsPage";
import { HistoryPage } from "~/features/transactions/HistoryPage";
import { ImportRoute } from "~/features/import/ImportRoute";
import { RecurringPage } from "~/features/recurring/RecurringPage";
import { detectLocale } from "~/i18n";
import { ApiError, ReauthRequiredError, getMe } from "~/lib/api";
import { finishHardReload } from "~/lib/hard-reload";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which sign-in door to show, when the API says we are not in. */
  const [authState, setAuthState] = useState<"unclaimed" | "login" | null>(null);
  /*
   * Latched locally rather than re-fetching `/api/me`. The save has already returned by the time this
   * is set, so the server agrees; a refetch would only add a blank frame between the two screens.
   */
  const [setupDone, setSetupDone] = useState(false);

  /*
   * Second pass of the hard reload, if one is in flight.
   *
   * Runs before anything else touches the network, and is a no-op on every ordinary load. The
   * caches could not be cleared during the first pass without leaving the app on a black screen —
   * see lib/hard-reload.ts — so this is where the orphaned ones go.
   */
  useEffect(() => {
    void finishHardReload();
  }, []);

  useEffect(() => {
    getMe()
      .then((profile) =>
        setMe({
          ...profile,
          // The server stores a locale; fall back to the browser's preference on first load,
          // before the member row has ever been edited.
          locale: isLocale(profile.locale) ? profile.locale : detectLocale(),
        }),
      )
      .catch((cause: Error) => {
        // A reauth navigation is already in flight — showing an error would flash on the way out.
        if (cause instanceof ReauthRequiredError) return;

        /*
         * The server says which door fits: a fresh deployment gets claimed, a claimed one gets the
         * passkey login. This replaced the old Zero Trust setup screen — Access is optional
         * hardening now, so "Access not configured" is no longer an error state at all.
         */
        if (cause instanceof ApiError && cause.authState) {
          setAuthState(cause.authState);
          return;
        }
        setError(cause.message);
      });
  }, []);

  // The sync loop starts once, after sign-in, and runs for the life of the tab.
  useEffect(() => {
    if (!me) return;
    return startSync();
  }, [me]);

  /* /join works signed-out by definition: the invite token in the hash is the credential. */
  if (window.location.pathname === "/join") return <JoinScreen />;
  if (authState === "unclaimed") return <ClaimScreen />;
  if (authState === "login") return <LoginScreen />;

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-4xl" aria-hidden>
            ⚠️
          </div>
          <p>{error}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </main>
    );
  }

  if (!me) {
    // No skeleton screen: this is a single API call behind an already-authenticated session,
    // and a skeleton would flash rather than inform.
    return <main className="mx-auto w-full max-w-3xl p-4" aria-busy="true" />;
  }

  /*
   * One provider, with the gate inside it.
   *
   * Two `return`s each wrapping their own `<AppProvider>` would also work — React keeps the instance
   * because the element type and position match — but only by coincidence of structure, and the
   * coincidence is load-bearing: the provider holds the currency setting the setup screen just saved,
   * so remounting it would drop the answer and show the app the old base.
   *
   * A fresh installation answers one question and then has an app. An upgrade never reaches this
   * branch: `needs_currency_setup` is false the moment anything has been recorded.
   */
  return (
    <AppProvider me={me}>
      {me.needs_currency_setup && !setupDone ? (
        <CurrencySetup onDone={() => setSetupDone(true)} />
      ) : (
        <RouterProvider>
          <Shell>
            <Routes />
          </Shell>
        </RouterProvider>
      )}
    </AppProvider>
  );
}

function Routes() {
  const { route } = useRouter();

  switch (route.name) {
    case "history":
      return <HistoryPage />;
    case "reports":
      return <ReportsPage />;
    case "settings":
      return <SettingsPage />;
    case "accounts":
      return <AccountsPage />;
    case "categories":
      return <CategoriesPage />;
    case "budgets":
      return <BudgetsPage />;
    case "import":
      return <ImportRoute />;
    case "recurring":
      return <RecurringPage />;
    case "home":
      return <HomePage />;
  }
}
