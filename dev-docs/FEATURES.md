# Feature backlog

Each entry below is a user story for a future change. Keep them short and
implementation-agnostic — the *what* and *why*, not the *how*.

---

## 5. Treat closely-spaced feedings as one for the countdown

**Why.** When a feeding is split into two short bursts with a small break
in between (e.g. baby pulls off the breast for a moment, then resumes; or
breast quickly followed by a top-up bottle), the "next feeding" countdown
currently resets to the *second* feeding's start time. That makes the
countdown shorter than reality — the baby effectively just had one long
feed, not two fresh ones.

**What the user should see.**

- A new setting: **Max gap to merge feedings (minutes)**. Optional —
  empty/zero means "never merge, current behaviour".

- When computing "Next feeding", if the most recent feeding's predecessor
  ended within this many minutes of the most recent feeding's start, the
  two are treated as a single chain for the countdown. The chain extends
  backwards across as many feedings as keep meeting the threshold (so
  three or more closely-spaced feeds also merge).

- The countdown anchor is the **start time of the earliest feeding in
  the chain**, plus the regular feeding interval.

**Examples** (with `max gap = 30 min`, `feeding interval = 180 min`):

- A: 10:00–10:05 · B: 10:30–10:35 — gap A→B = 25 min ≤ 30 → merge →
  next feeding due at **A.start + 180 = 13:00**.
- A: 10:00–10:05 · B: 10:40–10:50 — gap = 35 min > 30 → no merge →
  next feeding due at **B.start + 180 = 13:40**.
- A: 10:00–10:05 · B: 10:20–10:25 · C: 10:45–10:50 — gaps 15 and 20,
  both ≤ 30 → all three merge → next due at **A.start + 180 = 13:00**.

**Notes.**

- Only affects the **"Next feeding" countdown** and the chosen "Last
  feeding" anchor displayed alongside it. Feed counts, today's totals,
  and history listings still show every entry separately.
- "Feeding" here means the same thing it does elsewhere: any non-comfort
  breast or bottle entry. Comfort entries and pumps are ignored when
  building the chain.
- The threshold compares the **end of the earlier feed to the start of
  the later one** — that is, the actual idle time the baby spent not
  feeding.
- If the setting is unset/zero, behaviour is identical to today's.

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
