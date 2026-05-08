# Feature backlog

Each entry below is a user story for a future change. Keep them short and
implementation-agnostic — the *what* and *why*, not the *how*.

---

## 6. Daily round-robin backups of the data tabs

**Why.** A single accidental delete (someone fat-fingers the wrong entry,
or a stale device pushes old state, or a manual edit in the sheet goes
wrong) currently loses data with no way to recover. We want a lightweight
automatic safety net: a small rolling window of full-table snapshots
sitting next to the live data in the same sheet, so a slip-up can be
undone by copying rows back from yesterday's backup.

**What the system does (no UI changes — backend only).**

- Whenever the backend handles a write (entry/weight add, update or
  delete) and detects it is the **first write of a new local day** (the
  current date in the spreadsheet's timezone differs from the last
  recorded backup date), it takes a snapshot **before applying the
  write**.
- The snapshot is a **full copy** of both data tabs:
  - `feedings` → `feedings_backup_YYYY-MM-DD`
  - `weight`   → `weight_backup_YYYY-MM-DD`
  …where `YYYY-MM-DD` is the date of the data being preserved (i.e.
  yesterday from the perspective of the new write that triggered it).
- Only the **3 most recent backup pairs** are kept. Before creating a
  new pair, if there are already 3 pairs the oldest pair (by date in
  the tab name) is deleted. End state: at any time exactly 6 backup
  tabs exist, 3 per data tab, covering up to the last 3 days the family
  was active.
- A `lastBackupDate` value in the `settings` tab tracks when the
  rotation last ran so the trigger only fires once per day.

**Example** (today is Wed, existing backups for Sat / Sun / Mon).

- First write on Wed → backup of Tue is created
  (`feedings_backup_<Tue>`, `weight_backup_<Tue>`); the Sat pair is
  deleted. Final tabs: backups for Sun, Mon, Tue.
- A second write later on Wed → no backup activity (already done today).
- First write on Thu → backup of Wed is created; Sun pair is deleted.
  Final tabs: backups for Mon, Tue, Wed.

**Notes.**

- Pure backend feature — Apps Script only. The frontend never sees these
  tabs and no client behaviour changes.
- "First write" includes any mutating action (add / update / delete of
  entries or weights). Pure reads (bootstrap, list-entries) do not
  trigger a backup.
- Day boundary uses the **spreadsheet's timezone**, the same notion of
  "today" the rest of the app uses (not UTC).
- Backups are full flat copies of the source tab, headers included.
  Restoring is a manual operation (open the sheet, copy rows back) —
  no in-app restore UI in this version.
- If the family doesn't use the app on a given day, no backup is created
  for that day; the next backup just covers all the inactive days as a
  single "previous-day" snapshot.
- If a snapshot fails (rare — quota or transient sheet API hiccup), the
  triggering write should still go through: backups are best-effort.
- If the user manually deletes a backup tab in the sheet, that's fine —
  the next rotation just creates whatever is missing and continues.

---

# Done

- **1. Restructure top stats** (commit `4efc5ef`, 2026-05-07) — split the
  top metrics into a feeding/pumping status row plus a today-details row
  with feed-count, bottle-ml and breast-minutes breakdowns; "Next feeding"
  now also shows the absolute clock time.
- **2. Daily formula limit warning** (commit `65efba5`, 2026-05-07) —
  optional Settings → Daily formula limit (ml); warning modal before
  starting a bottle when today's non-comfort formula is at/above the limit.
- **3. Sync running sessions across devices** (commit `15f4582`, 2026-05-07,
  duplicate-row race fixed in `c3c7986`, 2026-05-08) — active sessions
  live as `end=null` rows in the sheet so every device sees the live
  timer; conflict modal (Continue / Stop & start / Discard & start) when
  starting a session while one is already running, on any device.
- **4. Offer bottle chain after a breast feeding** (2026-05-08) — after
  stopping any breast session (real or comfort) the app asks "Continue
  with a bottle?"; Yes starts a bottle session in one tap. Toggle in
  Settings → *Offer bottle after a breast feeding* (default on).
- **5. Group closely-spaced feedings as one feeding session** (2026-05-08)
  — new Settings → *Max gap to merge feedings (minutes)*; entries within
  the gap render as a single chain card in history (each row still
  tappable to edit). The "Next feeding" countdown anchors on the chain's
  earliest non-comfort start, and "Feeds today" counts a chain as one
  session. Default: empty (opt-in, no behaviour change for existing
  families).
