# Screenshot fixture

This folder is **not** end-user documentation. It holds the dev-only fixture used to render the app with realistic mock data so we can capture the screenshots in [`docs/screenshots/`](../../docs/screenshots/) without needing a real Google Sheet.

## How it works

- `index.html` — fixture entry page. It loads `fixture-data.js` first (which patches `window.fetch` and pre-fills `localStorage`), then dynamically pulls the body of the real `../../index.html`, mounts it, and finally loads `../../app.js`. The DOM stays in sync with production automatically — only the data and network layer are mocked.
- `fixture-data.js` — defines `installFixture()`. Sets a fake API URL + passcode + active user, intercepts every request to that URL with canned responses, and seeds a small fixture data set (Mama / Papa / Grandpa, a few feeds today, yesterday's history, a four-week weight series).

## Running it locally

From the repo root:

```bash
python3 -m http.server 8765
# then open http://localhost:8765/dev-docs/screenshots/
```

The setup wizard should be skipped and you should land directly on a populated home screen.

## Capturing screenshots

Capture them at a phone-sized retina viewport (e.g. **390×844** with `devicePixelRatio: 2`) and save them into [`../../docs/screenshots/`](../../docs/screenshots/) using the canonical filenames listed in that folder's `README.md`. Don't commit anything from this fixture into `docs/` — that folder is end-user content only.
