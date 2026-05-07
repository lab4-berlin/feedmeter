# Feature backlog

Each entry below is a user story for a future change. Keep them short and
implementation-agnostic — the *what* and *why*, not the *how*.

---

## 1. Restructure top stats

**Why.** The current top-of-screen metrics fit too much information into a
single row of small cards. We want to give feeding and pumping their own
visual blocks and surface a few extra numbers that are useful at a glance
(absolute time of next feeding, breakdown of today's feeds and bottle volume).

**What the user should see.**

The metrics area becomes two rows:

**Row 1 — status (two side-by-side blocks)**

- *Feeding block* (left)
  - Last feeding (relative time, e.g. "19m ago")
  - Next feeding (relative + **absolute clock time**, e.g. "in 2h 31m · 14:30")

- *Pumping block* (right)
  - Last pumping (relative time)
  - Total pumped volume today
  - No "next pumping" — pumping has no schedule

**Row 2 — today's feeding details (three cells)**

- *Feeds today (count)*
  - Total count, **excluding comfort feedings**
  - Broken down into breast vs bottle, e.g. "5× · 3 breast · 2 bottle"

- *Bottle ml today*
  - Total ml from bottles
  - Broken down into "own milk" vs "formula", e.g. "150 ml · 100 own · 50 formula"

- *Breast time today*
  - Total minutes spent on the breast (left + right combined)

**Notes.**

- A "feed" in row 2 means any non-comfort breast or bottle entry. Pumping is
  not a feed.
- Bottle source breakdown only counts bottles with a chosen source. Bottles
  with no source recorded should still contribute to the total volume.
- Layout should stay readable on a narrow phone screen — if a sub-breakdown
  would overflow, dropping the breakdown (showing only the headline number)
  is acceptable.

---

## 2. Daily formula limit warning

**Why.** When supplementing breastfeeding with formula, parents often want to
cap how much formula the baby gets per day. The app should help by warning
when the day's formula intake is already at or above the desired limit —
without blocking the entry, since real life sometimes requires going over.

**What the user should see.**

- A new setting: **Daily formula limit (ml)**. Optional — empty means "no
  limit, no warning". Lives next to the other thresholds in Settings.

- When the user starts a new **bottle** session, if today's already-recorded
  formula intake is at or above the limit, show a non-blocking warning
  *before* the timer starts:

  > Today's formula is already at the daily limit (e.g. *"600 ml of 600 ml"*).
  > If this bottle is formula, it will be over the limit.
  > **OK** — continue and start the bottle. **Cancel** — abandon.

- Two buttons: **OK** continues normally (timer starts), **Cancel** does
  nothing.

**Notes.**

- The warning is purely informational. The user is never prevented from
  starting the bottle, and they're not asked at that moment whether it's
  formula — that's only chosen at save time.
- The check uses the sum of `volume` for today's bottle entries with
  `source: formula` (excluding comfort entries).
- If the limit setting is unset/zero, this feature is a no-op.
- No warning is shown for breast feedings or pumping.

---

## 3. Sync running sessions across devices

**Why.** Today, a session only becomes visible to the rest of the family
when it's *finished* — until then it lives only in the device that started
it. That breaks the typical hand-off: one parent starts breastfeeding,
hands the baby to the other parent who continues with a bottle, and the
running session is invisible to everyone except the original phone. Worse,
the original phone may forget to stop the session, or both parents may
inadvertently start sessions in parallel.

**What the user should see.**

- The moment a session starts on any device, it is recorded centrally with
  a start time and no end time — i.e. as an **active session**. All other
  devices see it as live (with the running timer, the same way the local
  device does).

- Only **one active session per family** is allowed at a time, regardless
  of type or device. The active session can be of any type (left, right,
  bottle, pump).

- When a user tries to start a new session and an active one already
  exists (whether started by them or by someone else), they are shown a
  modal that explains the situation and offers:
  - **Continue old** — keep the active session running, do nothing.
  - **Stop old & start new** — close the old session (saving it as-is)
    and immediately start the new one.
  - **Discard old & start new** — drop the old session entirely (don't
    save it) and start the new one fresh.

- The same single-active-session check also covers the running timer on
  one's own device — i.e. there is no longer a difference between "my
  device's local active session" and "someone else's active session".

- Editing/deleting active sessions follows the same rules as completed
  entries.

**Why it matters in practice.**

- *Hand-off:* mama starts the breast on her phone → the dad's phone
  immediately shows "Left breast running, 03:12". When the baby switches
  to the bottle on dad's phone, dad sees the still-running breast session,
  taps **Stop old & start new**, the breast is closed, the bottle starts.

- *Forgotten stop:* mama starts the breast and goes to bed without
  stopping. The next morning, anyone starting a session sees the stale
  running session and is prompted — they can stop it or discard it.

**Notes.**

- This is a return to the open-entry model the project briefly had for
  Google Assistant integration; same concept (one row created at start,
  closed at finish), just generalised to all session sources.
- Devices need to learn about new active sessions reasonably quickly —
  on app focus / regular polling is fine, real-time is not required.
- An active session shown on another device should display the running
  timer ticking just like on the originating device.
- Behaviour when offline: the device that started the session keeps
  running locally; the central record is created as soon as the network
  is reachable again. Conflict resolution can be best-effort — the
  spirit is "try to keep everyone in sync", not "guaranteed exclusivity".

---

## 4. Offer to chain a bottle after a breast feeding

**Why.** A common pattern is: baby gets the breast, but there isn't enough
milk or the baby is too tired, so the parent immediately follows up with a
bottle. Today this requires four taps (stop breast → save → start bottle
→ stop bottle), and the two related entries can come from different
people on different phones. We can make the chained case a single,
guided flow.

**What the user should see.**

When a **breast** session ends, after the existing save/comfort flow has
been resolved and the breast entry has been recorded, the app asks:

> Continue with a bottle?
> **Yes, start bottle** — immediately starts a bottle session.
> **No** — finish here, return to the home screen.

If the user picks "Yes, start bottle", a bottle session begins right away
(timer running) as if they had tapped the Bottle tile themselves.

**Notes.**

- Only triggers after **left** or **right** breast sessions. Bottle/pump
  finishes do not show this prompt.
- Triggers regardless of whether the breast was marked as a real or
  comfort feed — both cases are commonly followed by a bottle.
- The chained bottle is its own independent entry. There is no special
  "linked" relationship between the two entries beyond their timestamps
  being close together.
- If the parent explicitly cancelled / discarded the breast session
  (i.e. nothing was saved), do **not** show the prompt.
- Consider exposing a setting to disable the prompt for users who don't
  combination-feed.
- If feature #3 (synced active sessions) lands first, the bottle started
  via this prompt is just a normal active session — no special handling
  needed.

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
