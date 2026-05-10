# Screenshots

These images are referenced from [`../what-feedmeter-does.md`](../what-feedmeter-does.md). Refresh them whenever the visible UI changes.

## How to refresh

1. Open the app in a phone-sized browser window — e.g. Chrome DevTools responsive mode at **390×844** (iPhone-ish), or use a real phone.
2. Make sure realistic-looking data is showing (a few entries, a couple of users, today not empty). A throwaway test sheet works well.
3. Capture each shot below and save it under the same filename, replacing the existing one. Keep filenames stable so the doc's image links don't break.
4. Commit the new screenshots together with the doc/code change that made them stale.

## What each screenshot should show

| File | Contents |
|------|----------|
| `home.png` | Full home screen: header (brand + user chip + gear), the **Feeding** / **Pumping** status row, the today-details row, all four tiles in their idle state, and a few rows of history below. |
| `tile-live.png` | Close-up of any tile in **LIVE** state, showing the pulsing badge, the running timer, and the "Tap to stop" hint. |
| `bottle-save.png` | The "Save session" modal that appears after stopping a bottle — both the **Source** segments (Own milk / Formula) and the **Volume** input visible. |
| `comfort.png` | The **Short feeding** modal asking real-feeding vs comfort-only. |
| `chain-bottle.png` | The **Continue with a bottle?** modal offered after a breast feed (combination feeding prompt). |
| `chain.png` | A **chain card** in History — multiple closely-spaced feedings grouped as one session, with the "CHAIN N FEEDS" header and time range visible. Requires `mergeMaxGapMin` set in Settings. |
| `edit-entry.png` | The **Edit entry** modal opened from a tapped history row, showing start/end pickers, source, volume, and the comfort checkbox. |
| `weight.png` | The **Weight** tab — chart with at least 4–5 points and a few rows in the entries list. |
| `settings.png` | The **Settings** modal scrolled to show several of the fields. |
| `conflict.png` | The **Session already running** modal with all three buttons visible. |
| `chain-bottle.png` | The **Continue with a bottle?** modal that appears right after stopping a breast feeding. |
| `chain.png` | A **chain card** in history grouping 2–3 closely-spaced feedings (mix of breast and bottle if possible) with the chain header visible. Captured with `Max gap to merge feedings` set in Settings. |

## Format conventions

- **PNG**, captured at 2× DPR (retina) so they look sharp on phones.
- **Lowercase, hyphenated** filenames.
- Aim for ~150–400 KB per image. If a file balloons over ~600 KB, run it through a quick optimizer (e.g. `pngquant`).
- Crop tightly — avoid showing the browser chrome.
- No real names, real Google account info, or other personal data. Use placeholder users like *Mama*, *Papa*, *Lena*.
