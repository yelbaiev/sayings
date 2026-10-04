/*
 * Push handling, pulled into the generated service worker by `workbox.importScripts` in
 * vite.config.ts. Plain JS because it runs as-is in the worker scope; there is no build step for it.
 *
 * A push from SAYings carries its own text (encrypted end to end — see worker/push.ts), so nothing
 * here fetches: a phone woken in the background may have no usable sign-in session, and the
 * message must not depend on one.
 *
 * iPhone requires every push to show a notification, so this always shows one.
 */

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // An unreadable payload still has to surface as a notification on iOS.
  }

  const title = message.title || "SAYings";
  const count = typeof message.count === "number" ? message.count : null;

  const work = [
    self.registration.showNotification(title, {
      body: message.body || "",
      icon: "/icon-192.png",
      // One notification per kind: today's replaces yesterday's instead of stacking.
      tag: "due-payments",
      data: { url: message.url || "/recurring" },
    }),
  ];

  // The icon count, updated in the background — the reason the morning push exists.
  if (count !== null && "setAppBadge" in self.navigator) {
    work.push(
      (count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge()).catch(() => {}),
    );
  }

  event.waitUntil(Promise.all(work));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/recurring", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Reuse the open app rather than starting a second copy of it.
      for (const client of windows) {
        if ("focus" in client) {
          return client.focus().then((focused) => ("navigate" in focused ? focused.navigate(url) : focused));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
