import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "./harness";

/**
 * Settings → Reminders, in each state an iPhone can be in.
 *
 * The switch is a permission request in disguise: the badge only shows once notifications are
 * allowed, iPhone only allows asking inside the home-screen app, and a refusal can only be undone
 * in the system Settings. Each of those has to say so rather than leave a switch that does nothing.
 */

const setDevicePrefs = vi.fn(async (_patch: Record<string, unknown>) => undefined);

vi.mock("~/db/dexie", () => ({
  db: {},
  getDevicePrefs: () => Promise.resolve({ id: "prefs", theme: "system", lastAccountByCategory: {} }),
  setDevicePrefs: (patch: Record<string, unknown>) => setDevicePrefs(patch),
  resetLocalMirror: () => Promise.resolve(),
}));

const { RemindersSection } = await import("~/features/settings/SettingsPage");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";

function withNotification(permission: NotificationPermission | null, request?: () => Promise<NotificationPermission>) {
  if (permission === null) {
    vi.stubGlobal("Notification", undefined);
  } else {
    vi.stubGlobal("Notification", { permission, requestPermission: request ?? (async () => permission) });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDevicePrefs.mockClear();
});

describe("the reminders switch", () => {
  it("asks for the Home Screen first in a Safari tab on iPhone", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
    withNotification(null);
    renderInApp(<RemindersSection />);

    expect(screen.getByRole<HTMLInputElement>("switch").disabled).toBe(true);
    expect(screen.getByText(/экран «Домой»/u)).toBeTruthy();
  });

  it("points an iPhone to the system Settings once permission was refused", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
    withNotification("denied");
    renderInApp(<RemindersSection />);

    expect(screen.getByRole<HTMLInputElement>("switch").disabled).toBe(true);
    expect(screen.getByText(/Настройках iPhone/u)).toBeTruthy();
  });

  it("points Android to the browser's site settings instead", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID);
    withNotification("denied");
    renderInApp(<RemindersSection />);

    expect(screen.getByText(/настройках сайта в браузере/u)).toBeTruthy();
    expect(screen.queryByText(/iPhone/u)).toBeNull();
  });

  it("is available in an ordinary Android browser tab — no Home Screen step", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID);
    withNotification("default");
    renderInApp(<RemindersSection />);
    expect(screen.getByRole<HTMLInputElement>("switch").disabled).toBe(false);
  });

  it("asks for permission on tap and turns on when it is granted", async () => {
    const request = vi.fn(async () => "granted" as NotificationPermission);
    withNotification("default", request);
    renderInApp(<RemindersSection />);

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(setDevicePrefs).toHaveBeenCalledWith({ reminders: true }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stays off when permission is dismissed", async () => {
    withNotification("default", async () => "default");
    renderInApp(<RemindersSection />);

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("switch").disabled).toBe(false));
    expect(setDevicePrefs).not.toHaveBeenCalled();
  });
});

describe("the app-icon badge", () => {
  it("shows the count, clears at zero, and never throws", async () => {
    const { setBadge } = await import("~/lib/notifications");
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    Object.assign(navigator, { setAppBadge, clearAppBadge });

    await setBadge(2);
    expect(setAppBadge).toHaveBeenCalledWith(2);
    await setBadge(0);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);

    // Refused by the platform (no permission yet): a quiet no-op, not an error on screen.
    setAppBadge.mockRejectedValueOnce(new Error("NotAllowedError"));
    await expect(setBadge(3)).resolves.toBeUndefined();
  });
});
