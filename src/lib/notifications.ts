import { useLiveQuery } from "dexie-react-hooks";
import { db, setDevicePrefs } from "~/db/dexie";

/**
 * Reminders: the due-payment count on the app icon, and (from the next phase) the morning push.
 *
 * iPhone rules that shape everything here (WebKit, iOS 16.4+):
 * - The badge only *shows* once the person has allowed notifications, so turning reminders on is
 *   a permission request.
 * - That request is only possible in the home-screen app, from a tap — never in a Safari tab.
 * - A closed app cannot change its badge except from a push. Until the push phase ships, the badge
 *   is set whenever the app is open and keeps that number after it closes.
 *
 * See docs/plans/push-reminders.md.
 */

export type ReminderAvailability =
  /** No Notification API at all: an older iOS, or a browser without it. */
  | "unsupported"
  /** iPhone in a Safari tab: the API exists only for home-screen apps. */
  | "needs-home-screen"
  /** Refused before. Browsers cannot ask twice; only the system Settings can undo it. */
  | "denied"
  | "available";

/** True when running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; touch is what gives it away.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function reminderAvailability(): ReminderAvailability {
  if (typeof Notification === "undefined") {
    // On iPhone the API is withheld from Safari tabs entirely, so its absence there means
    // "install first" rather than "never".
    return isIos() && !isStandalone() ? "needs-home-screen" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "available";
}

/** Whether this phone has reminders on. Per device, like the theme: each person turns it on. */
export function useRemindersOn(): boolean {
  const prefs = useLiveQuery(() => db.devicePrefs.get("prefs"), []);
  return prefs?.reminders === true;
}

/**
 * Turns reminders on: asks for permission (must run inside a tap), then records the choice.
 * Resolves to whether they are now on.
 */
export async function enableReminders(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return false;
  await setDevicePrefs({ reminders: true });
  return true;
}

export async function disableReminders(): Promise<void> {
  await setDevicePrefs({ reminders: false });
  await setBadge(0);
}

type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Sets the app-icon count, or clears it at zero. A quiet no-op where badging does not exist, and
 * never throws — a badge is a nicety, and a failure here must not reach the screen.
 */
export async function setBadge(count: number): Promise<void> {
  const nav = navigator as BadgingNavigator;
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Unsupported context or permission not granted: nothing to show, nothing to report.
  }
}
