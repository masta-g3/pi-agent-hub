// Shows Hub request notifications and opens the session when one is tapped. Nothing is cached.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* a notification must still be shown */ }
  const url = typeof message.url === "string" && message.url.startsWith("/#/") ? message.url : "/";
  event.waitUntil(self.registration.showNotification(String(message.title ?? "Hub"), {
    body: String(message.body ?? "An agent needs you"),
    tag: typeof message.tag === "string" ? message.tag : undefined,
    icon: "/icon-192.png",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = pages[0];
    if (!page) return self.clients.openWindow(url);
    await page.focus();
    page.postMessage({ url });
  })());
});
