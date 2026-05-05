# FeedMeter

A simple, mobile-friendly feeding tracker for **babies**. Tracks breastfeeding (left/right), bottle feeds (own milk or formula), and pumping. All data lives in your own Google Sheet — no third-party cloud, no accounts beyond Google.

## Features

- Four big tap-tiles: **Left**, **Right** (breast), **Bottle**, **Pump**.
- Tap to start a session — the active tile shows a live timer with a pulsing **LIVE** badge. Tap it again to stop.
- Breast feeds save instantly. Bottle/Pump prompt for the minimum needed (volume, plus own-milk vs formula for bottles).
- **Top stats**: last feeding (relative time), next feeding due (countdown that turns red when overdue), today's count + intake.
- **History** grouped by day. Tap any entry to edit start/end/volume/source or delete it.
- **Multi-user**: one shared family passcode protects the sheet. On each device the user picks their name (Mama / Papa / …) so every row records *who* logged it. New names can be added straight from the app.
- **Settings**: edit feeding/pumping interval right from the app — saved to the sheet.
- **Optimistic offline**: actions go to local cache instantly and sync when the network comes back. The sheet is the source of truth.
- **Privacy**: data goes from your phone straight to your own Google Sheet. No analytics, no third party.

## Architecture

```
[Phone / Browser]
   │  HTTPS POST { passcode, action, data }
   ▼
[Google Apps Script Web App]
   │  validates passcode, reads/writes sheet
   ▼
[Google Sheet]
   ├── tab "entries"   — all feeding records (with id, who, when, type, vol, source)
   └── tab "settings"  — passcode, intervals, list of users
```

The frontend is pure static HTML/CSS/JS — host it anywhere (GitHub Pages, Netlify, Vercel, even open the file locally). The "backend" is a 200-line Apps Script that lives inside your spreadsheet.

## Setup (one-time, ~5 minutes)

See [`SETUP.md`](./SETUP.md) for the step-by-step. TL;DR:

1. Create a Google Sheet.
2. Extensions → Apps Script → paste [`apps-script.gs`](./apps-script.gs).
3. Deploy as a Web App ("Anyone" access). Copy the URL ending in `/exec`.
4. Open the FeedMeter page; paste the URL and pick a passcode (in the `settings` sheet, change `passcode` from `changeme`).
5. Pick your name. Done.

## Run the frontend

It's just static files. Any of:

- Open `index.html` directly (file://). Works fully — but the PWA install needs a real URL.
- Local server: `python3 -m http.server 8000` → http://localhost:8000
- Host on GitHub Pages / Netlify Drop / Vercel for a real URL you can put on your phone's home screen.

For phones, after hosting, open the URL in Safari/Chrome → **Share → Add to Home Screen**.

## Files

- `index.html` — markup, modals, tiles, header
- `styles.css` — mobile-first design, no framework
- `app.js` — UI, timer, optimistic state, API client
- `apps-script.gs` — the Apps Script backend (paste into your sheet's script editor)
- `SETUP.md` — setup walkthrough
- `manifest.webmanifest`, `icon-192.svg`, `icon-512.svg` — PWA
- `README.md` — this file

## Data model

`entries` tab columns:

| col | description |
|-----|-------------|
| `id` | UUID assigned server-side |
| `createdAt` | timestamp the row was inserted |
| `updatedAt` | timestamp of the last edit |
| `user` | who logged the entry (e.g. *Mama*) |
| `type` | one of `left` / `right` / `bottle` / `pump` |
| `start` | session start time |
| `end` | session end time |
| `durationSec` | server-computed duration in seconds |
| `volumeMl` | bottle/pump volume in ml (blank otherwise) |
| `source` | bottle source: `own` or `formula` (blank otherwise) |
| `deleted` | `TRUE` if soft-deleted (kept for audit trail) |

`settings` tab is a simple `key | value` table. Special key: `user` — it can repeat, one row per known person.

## Roadmap ideas

- Diaper / sleep tracking tiles.
- Push reminders when the next feeding is due.
- Charts inside the sheet (a separate tab with formulas/charts is easy to add).
- Offline write queue with retry-with-backoff (currently retries on tab focus + after manual edits).
- Multi-baby support.

## Privacy & security notes

- The Web App URL is public; the **passcode** is the gate. Anyone with both can read/write the sheet via the API.
- Rotate the passcode any time by changing the cell in the `settings` tab.
- The sheet itself is private to your Google account — only the script (running as you) can read it.
- HTTPS only.
