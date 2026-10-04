import { useLiveQuery } from "dexie-react-hooks";
import { db, setDevicePrefs } from "~/db/dexie";
import { ApiError, apiFetch } from "~/lib/api";

/**
 * Reminders: the due-payment count on the app icon, and (from the next phase) the morning push.
 *
 * iPhone rules that shape everything here (WebKit, iOS 16.4+):
 * - The badge only *shows* once the person has allowed notifications, so turning reminders on is
 *   a permission request.
 * - That request is only possible in the home-screen app, from a tap — never in a Safari tab.
 * - A closed app cannot change its badge except from a push. The badge is set whenever the app is
 *   open; a push (public/push-sw.js) is what updates it while closed.
 *
 * Turning reminders on also subscribes this phone to push, when the installation has push keys
 * (worker/push.ts). Without them the badge still works and push is simply skipped.
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

export function isIos(): boolean {
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
  // Best effort: the badge does not depend on push, so a push failure must not undo the switch.
  await subscribePush().catch(() => false);
  return true;
}

export async function disableReminders(): Promise<void> {
  await setDevicePrefs({ reminders: false });
  await setBadge(0);
  await unsubscribePush().catch(() => undefined);
}

/* ------------------------------------------------------------------------------ push */

function pushAvailable(): boolean {
  return "serviceWorker" in navigator && typeof PushManager !== "undefined";
}

function toB64url(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer) return "";
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Subscribes this phone to push and registers it with the server. Resolves to whether push is now
 * set up. Idempotent: an existing subscription for the same key is re-registered, not replaced —
 * which is also how a phone that turned reminders on before push existed gets enrolled.
 */
export async function subscribePush(): Promise<boolean> {
  if (!pushAvailable() || Notification.permission !== "granted") return false;
  const { publicKey } = await apiFetch<{ publicKey: string | null }>("/api/push/key");
  if (!publicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with an older server key cannot receive messages signed with this one.
  if (subscription && toB64url(subscription.options.applicationServerKey) !== publicKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromB64url(publicKey),
  });

  await apiFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return true;
}

async function unsubscribePush(): Promise<void> {
  if (!pushAvailable()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await apiFetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

export type TestResult = "sent" | "no-subscription" | "not-configured" | "failed";

/** "Send a test" in Settings. */
export async function sendTestNotification(): Promise<TestResult> {
  try {
    // Re-register first, so a test straight after an update (or a lost subscription) still lands.
    if (!(await subscribePush())) {
      const { publicKey } = await apiFetch<{ publicKey: string | null }>("/api/push/key");
      return publicKey ? "no-subscription" : "not-configured";
    }
    const { sent } = await apiFetch<{ sent: number; failed: number }>("/api/push/test", { method: "POST" });
    return sent > 0 ? "sent" : "failed";
  } catch (error) {
    return error instanceof ApiError && error.status === 503 ? "not-configured" : "failed";
  }
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
