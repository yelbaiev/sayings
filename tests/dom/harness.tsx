import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { AppProvider, type Me } from "~/app/AppContext";

/**
 * Renders inside the app's context, which anything using `t()` needs.
 *
 * Russian rather than English on purpose: it is the language the household actually uses, and the one
 * whose longer strings expose clipping and wrapping. A test suite that only ever sees English labels
 * is testing a locale nobody runs.
 */
const me: Me = {
  id: "m1",
  email: "member@example.com",
  display_name: "Member",
  locale: "ru",
  default_account_id: null,
  role: "owner",
  household_id: "hh_default",
  base_currency: "UAH",
  enabled_currencies: ["UAH", "EUR", "USD"],
};

/**
 * `overrides` exists for the currency configuration, which is now a property of the household rather
 * than of the build — a test that wants to see what a euro household renders has to be able to say so.
 */
export function renderInApp(ui: ReactNode, overrides: Partial<Me> = {}) {
  return render(<AppProvider me={{ ...me, ...overrides }}>{ui}</AppProvider>);
}
