# FeedMeter

A tiny, mobile-friendly feeding tracker for newborns. No accounts, no servers — everything is stored locally in the browser.

Track:

- **Left breast** / **Right breast** — start/stop timer, side recorded automatically.
- **Bottle** — start/stop timer, choose **own milk** or **formula**, and enter volume in ml.
- **Pump** — start/stop timer, enter expressed volume in ml.

## How it works

1. Tap one of the four big tiles to start a session — the live timer appears at the top.
2. Tap **Stop** to end the session. A sheet pops up to capture the extras (volume, source, optional note).
3. Entries appear in **History**, grouped by day. Tap any entry to edit or delete it.
4. The header has an **Export** button to download all data as JSON (good as a backup).

Data is stored in `localStorage` under the keys `feedmeter.entries.v1` and `feedmeter.active.v1`.

## Run locally

It's just static files — open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Use it on a phone

The easiest path is to host it somewhere (any static host works) and add it to the home screen. The app declares a web manifest so iOS/Android will treat it as an installable PWA.

### Free hosting options

- **GitHub Pages**: push this folder to a repo and enable Pages.
- **Netlify drop**: drag the folder to https://app.netlify.com/drop.
- **Vercel / Cloudflare Pages**: import the repo.

On iPhone: open the URL in Safari → Share → **Add to Home Screen**.
On Android: open in Chrome → menu → **Install app**.

## Files

- `index.html` — markup
- `styles.css` — all styles (mobile-first, no framework)
- `app.js` — logic (timer, storage, rendering)
- `manifest.webmanifest`, `icon-192.svg`, `icon-512.svg` — PWA bits

## Privacy

Nothing leaves the device. There is no analytics, no backend, no third-party calls.
