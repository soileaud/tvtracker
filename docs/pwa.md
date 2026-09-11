# TVTrack as an installable app (PWA)

TVTrack ships as a Progressive Web App: `manifest.webmanifest` + `sw.js`
(service worker) + icon + theme color. That buys you:

- **Add to Home Screen** → fullscreen icon, no browser chrome.
- **App shell offline** — pages and static assets load on flaky Wi-Fi.
- **API fallback** — recently viewed API responses are served from cache
  when the network drops. Writes (watch toggles, ratings) always go to the
  network and fail loudly offline rather than silently diverging.

## Install

1. Run the production build (`npm run build`, `npm run start -w @tvtrack/server`)
   — the service worker only registers in prod builds, never in `vite dev`.
2. Open the app URL on the phone.
   - iOS Safari: Share → **Add to Home Screen**.
   - Android Chrome: menu → **Add to Home screen** / **Install app**.
3. Launch from the icon. Uninstall like any app (remove icon); to fully
   clear cached data, also remove the site's website data in browser settings.

## Files

| File | Purpose |
|---|---|
| `client/public/manifest.webmanifest` | Name, colors, standalone display, icon |
| `client/public/icon.svg` | TV glyph icon (favicon + home-screen) |
| `client/public/sw.js` | Cache-first assets, network-first `/api/*`, versioned `tvtrack-v1` cache |
| `client/index.html` | Manifest/theme-color/icon links, title |

Bump the `CACHE` name in `sw.js` whenever you change caching behavior so
clients drop the old cache on next visit.

## HTTPS caveat (read before expecting offline on LAN)

Service workers require a **secure context**. That includes `localhost`
(dev on the server itself) but **not** plain `http://192.168.x.x` in most
phone browsers — so over a raw LAN IP you'll get the installable icon but
the offline cache won't register. Options for full offline:

- **Tailscale** (easiest): gives every device a stable `https://…` name.
- **Caddy reverse proxy** on the server: one `Caddyfile` line gets you
  automatic LAN HTTPS (`tls internal`).
- Or just use it online — the app is fully functional without the worker;
  the worker is strictly an enhancement.

## Limitations / upgrade path

- The icon is SVG. Chrome accepts it; Safari's touch icon prefers PNG —
  if the iOS icon looks wrong, export 180×180 and 512×512 PNGs into
  `client/public/` and list them in the manifest (`sizes` + `purpose`).
- No push notifications (they need HTTPS + a push service — out of scope
  for local-only v1).
