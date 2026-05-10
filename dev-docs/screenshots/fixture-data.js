// Fixture data + fetch interceptor for screenshot generation.
//
// Loaded by ./index.html BEFORE the real ../../app.js runs. It pre-fills
// localStorage so the setup wizard is skipped and monkey-patches
// `window.fetch` so any call to the (fake) Apps Script URL returns canned
// data instead of hitting the network.
//
// All timestamps are computed relative to `Date.now()` at load time so
// "X min ago" labels look natural in the screenshots.

const FIXTURE_API_URL = 'mock://feedmeter';
const FIXTURE_PASSCODE = 'fixture';
const FIXTURE_USER = 'Mama';

function captureMode() {
  return new URLSearchParams(location.search).get('capture') || '';
}

function buildFixture() {
  const now = Date.now();
  const min = (n) => n * 60 * 1000;
  const hr = (n) => n * 60 * 60 * 1000;
  const day = (n) => n * 24 * 60 * 60 * 1000;
  const mode = captureMode();

  // ----- Today's entries (most recent first when reversed) -----
  // Layout (relative to "now"):
  //   T-3h00m  Mama, left breast, 14 min real feed
  //   T-2h45m  Papa, bottle 80 ml own milk, 8 min
  //   T-1h45m  Grandpa, right breast, 11 min real feed
  //   T-1h30m  Mama, pump 120 ml, 18 min
  //   T-30m    Papa, bottle 90 ml formula, 7 min
  //   (alternation arrow will land on LEFT — last real breast was right)

  const entries = [];
  const e = (offset) => ({
    id: offset.id,
    createdAt: new Date(now - offset.startAgo).toISOString(),
    updatedAt: new Date(now - offset.startAgo + 60_000).toISOString(),
    user: offset.user,
    type: offset.type,
    start: now - offset.startAgo,
    end: offset.endAgo == null ? null : now - offset.endAgo,
    durationSec: offset.endAgo == null
      ? null
      : Math.round((offset.startAgo - offset.endAgo) / 1000),
    volume: offset.volume ?? null,
    source: offset.source ?? null,
    deleted: false,
    isComfort: !!offset.isComfort,
  });

  entries.push(e({ id: 'fix-t-1', user: 'Mama',    type: 'left',   startAgo: hr(3) + min(14), endAgo: hr(3) }));
  entries.push(e({ id: 'fix-t-2', user: 'Papa',    type: 'bottle', startAgo: hr(2) + min(45) + min(8), endAgo: hr(2) + min(45), volume: 80, source: 'own' }));
  entries.push(e({ id: 'fix-t-3', user: 'Grandpa', type: 'right',  startAgo: hr(1) + min(45) + min(11), endAgo: hr(1) + min(45) }));
  entries.push(e({ id: 'fix-t-4', user: 'Mama',    type: 'pump',   startAgo: hr(1) + min(30) + min(18), endAgo: hr(1) + min(30), volume: 120 }));
  entries.push(e({ id: 'fix-t-5', user: 'Papa',    type: 'bottle', startAgo: min(30) + min(7), endAgo: min(30), volume: 90, source: 'formula' }));

  // ----- Yesterday's entries (so day-nav and history have something to show) -----
  const Y = day(1);
  entries.push(e({ id: 'fix-y-1', user: 'Mama', type: 'left',   startAgo: Y + hr(11),       endAgo: Y + hr(11) - min(13) }));
  entries.push(e({ id: 'fix-y-2', user: 'Papa', type: 'right',  startAgo: Y + hr(8),        endAgo: Y + hr(8) - min(9) }));
  entries.push(e({ id: 'fix-y-3', user: 'Mama', type: 'bottle', startAgo: Y + hr(6),        endAgo: Y + hr(6) - min(8),  volume: 100, source: 'own' }));
  entries.push(e({ id: 'fix-y-4', user: 'Mama', type: 'left',   startAgo: Y + hr(3),        endAgo: Y + hr(3) - min(2),  isComfort: true }));
  entries.push(e({ id: 'fix-y-5', user: 'Papa', type: 'bottle', startAgo: Y + min(45),      endAgo: Y + min(45) - min(7),volume: 110, source: 'formula' }));

  // For the "chain" screenshot we add two close-by feed entries as the
  // *most recent* events of today so the resulting chain card shows up
  // at the top of the history list (no scrolling needed). Combined with
  // settings.mergeMaxGapMin = 30 below, they render as one chain card.
  if (mode === 'chain') {
    entries.push(e({ id: 'fix-chain-a', user: 'Mama', type: 'left',   startAgo: min(25),                endAgo: min(15) }));
    entries.push(e({ id: 'fix-chain-b', user: 'Mama', type: 'bottle', startAgo: min(12),                endAgo: min(5),  volume: 60,  source: 'own' }));
  }

  // For the "conflict" screenshot we seed an already-running session by
  // someone else so that clicking another tile triggers the conflict modal
  // with realistic context ("Left breast is running by Papa — 4 min so far").
  if (mode === 'conflict') {
    entries.push({
      id: 'fix-active',
      createdAt: new Date(now - min(4)).toISOString(),
      updatedAt: new Date(now - min(4)).toISOString(),
      user: 'Papa',
      type: 'left',
      start: now - min(4),
      end: null,
      durationSec: null,
      volume: null,
      source: null,
      deleted: false,
      isComfort: false,
    });
  }

  // ----- Weight series: ~6 points spanning four weeks -----
  const dateStr = (offsetMs) => new Date(now - offsetMs).toISOString().slice(0, 10);
  const weights = [
    { id: 'w-1', date: dateStr(day(28)), weightG: 3200, timing: 'after',  createdAt: new Date(now - day(28)).toISOString(), updatedAt: new Date(now - day(28)).toISOString(), deleted: false },
    { id: 'w-2', date: dateStr(day(24)), weightG: 3050, timing: 'before', createdAt: new Date(now - day(24)).toISOString(), updatedAt: new Date(now - day(24)).toISOString(), deleted: false },
    { id: 'w-3', date: dateStr(day(20)), weightG: 3220, timing: 'after',  createdAt: new Date(now - day(20)).toISOString(), updatedAt: new Date(now - day(20)).toISOString(), deleted: false },
    { id: 'w-4', date: dateStr(day(14)), weightG: 3530, timing: 'after',  createdAt: new Date(now - day(14)).toISOString(), updatedAt: new Date(now - day(14)).toISOString(), deleted: false },
    { id: 'w-5', date: dateStr(day(7)),  weightG: 3820, timing: 'after',  createdAt: new Date(now - day(7)).toISOString(),  updatedAt: new Date(now - day(7)).toISOString(),  deleted: false },
    { id: 'w-6', date: dateStr(day(2)),  weightG: 4080, timing: 'after',  createdAt: new Date(now - day(2)).toISOString(),  updatedAt: new Date(now - day(2)).toISOString(),  deleted: false },
  ];

  const settings = {
    feedingIntervalMin: 180,
    minFeedDurationMin: 5,
    minBottleVolumeMl: 30,
    dailyFormulaLimitMl: 600,
    birthWeightG: 3200,
    offerBottleChain: true,
  };

  // The "chain" screenshot shows the grouped-feedings card; that only
  // appears when this opt-in setting is non-zero.
  if (mode === 'chain') settings.mergeMaxGapMin = 30;

  return {
    users: ['Mama', 'Papa', 'Grandpa'],
    settings,
    entries,
    weights,
  };
}

function installFixture() {
  localStorage.setItem('feedmeter.apiUrl', FIXTURE_API_URL);
  localStorage.setItem('feedmeter.passcode', FIXTURE_PASSCODE);
  localStorage.setItem('feedmeter.user', FIXTURE_USER);
  // Wipe any cached state from a previous run so each fixture load is fresh.
  localStorage.removeItem('feedmeter.cache.v2');
  localStorage.removeItem('feedmeter.active.v2');

  const FIXTURE = buildFixture();
  // Expose for debugging / for screenshot scripts that may want to mutate.
  window.__FIXTURE__ = FIXTURE;

  const realFetch = window.fetch.bind(window);
  const json = (payload) => new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith(FIXTURE_API_URL)) {
      return realFetch(input, init);
    }
    let body = {};
    try { body = JSON.parse((init && init.body) || '{}'); } catch {}
    const action = body.action;

    switch (action) {
      case 'ping':
        return json({});
      case 'bootstrap':
        return json({
          users: FIXTURE.users,
          settings: FIXTURE.settings,
          entries: FIXTURE.entries,
          weights: FIXTURE.weights,
        });
      case 'list-entries':
        return json({ entries: FIXTURE.entries });
      case 'add-entry': {
        const e = body.entry || {};
        const saved = {
          ...e,
          id: e.id || ('fix-new-' + Math.random().toString(36).slice(2, 8)),
          createdAt: e.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deleted: false,
        };
        const idx = FIXTURE.entries.findIndex(x => x.id === saved.id);
        if (idx >= 0) FIXTURE.entries[idx] = saved;
        else FIXTURE.entries.push(saved);
        return json({ entry: saved });
      }
      case 'update-entry': {
        const e = body.entry || {};
        const idx = FIXTURE.entries.findIndex(x => x.id === e.id);
        const merged = { ...(idx >= 0 ? FIXTURE.entries[idx] : {}), ...e, updatedAt: new Date().toISOString() };
        if (idx >= 0) FIXTURE.entries[idx] = merged;
        else FIXTURE.entries.push(merged);
        return json({ entry: merged });
      }
      case 'delete-entry': {
        const idx = FIXTURE.entries.findIndex(x => x.id === body.id);
        if (idx >= 0) FIXTURE.entries[idx] = { ...FIXTURE.entries[idx], deleted: true };
        return json({ id: body.id });
      }
      case 'add-user': {
        const name = String(body.name || '').trim();
        if (name && !FIXTURE.users.some(u => u.toLowerCase() === name.toLowerCase())) {
          FIXTURE.users.push(name);
        }
        return json({ users: FIXTURE.users });
      }
      case 'update-settings':
        FIXTURE.settings = { ...FIXTURE.settings, ...(body.settings || {}) };
        return json({ settings: FIXTURE.settings });
      case 'add-weight': {
        const w = body.weight || {};
        const saved = {
          id: 'fix-w-' + Math.random().toString(36).slice(2, 8),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          date: w.date || new Date().toISOString().slice(0, 10),
          weightG: Number(w.weightG) || 0,
          timing: w.timing || 'after',
          deleted: false,
        };
        FIXTURE.weights.push(saved);
        return json({ weight: saved });
      }
      case 'update-weight': {
        const w = body.weight || {};
        const idx = FIXTURE.weights.findIndex(x => x.id === w.id);
        const merged = { ...(idx >= 0 ? FIXTURE.weights[idx] : {}), ...w, updatedAt: new Date().toISOString() };
        if (idx >= 0) FIXTURE.weights[idx] = merged;
        return json({ weight: merged });
      }
      case 'delete-weight': {
        const idx = FIXTURE.weights.findIndex(x => x.id === body.id);
        if (idx >= 0) FIXTURE.weights[idx] = { ...FIXTURE.weights[idx], deleted: true };
        return json({ id: body.id });
      }
      default:
        return json({});
    }
  };

  console.info('[fixture] installed; users=%o, entries=%d, weights=%d',
    FIXTURE.users, FIXTURE.entries.length, FIXTURE.weights.length);
}

// ----- Capture-mode runner -----
// Triggered by the loader (./index.html) once `app.js` has finished its
// first render. Reads `?capture=<name>` and drives the UI into the state
// the screenshot of that name expects. Runs entirely inside the page so
// any external screenshot tool just needs to wait long enough.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (document.querySelector('#statTodayFeed')?.textContent !== '—') return true;
    if (document.querySelectorAll('#entries li').length > 0) return true;
    await sleep(50);
  }
  return false;
}

async function runCapture() {
  const mode = captureMode();
  if (!mode) return;
  await waitForReady();
  // Tiny extra settle for fonts / inline SVGs / chart layout.
  await sleep(150);

  const click = (sel) => {
    const el = document.querySelector(sel);
    if (!el) {
      console.warn('[fixture] selector not found:', sel);
      return false;
    }
    el.click();
    return true;
  };

  switch (mode) {
    case 'home':
      // Nothing to do.
      break;

    case 'tile-live':
      click('button.tile-bottle');
      // Let the LIVE timer tick a couple of seconds.
      await sleep(2200);
      break;

    case 'bottle-save':
      click('button.tile-bottle');
      await sleep(400);
      click('button.tile-bottle'); // stop -> save modal
      await sleep(250);
      click('button.seg-btn[data-source="own"]');
      const vol = document.getElementById('volumeInput');
      if (vol) {
        vol.value = '80';
        vol.dispatchEvent(new Event('input', { bubbles: true }));
      }
      break;

    case 'comfort':
      click('button.tile-left');
      await sleep(400);
      click('button.tile-left'); // shorter than minFeedDurationMin -> comfort modal
      break;

    case 'edit-entry':
      click('#entries li');
      break;

    case 'weight':
      click('button.tab-btn[data-tab="weight"]');
      await sleep(600); // chart paints async
      break;

    case 'settings':
      click('#settingsBtn');
      break;

    case 'conflict':
      // Active session was pre-seeded in buildFixture(). Just trigger the
      // collision by tapping a different tile.
      click('button.tile-bottle');
      break;

    case 'chain':
      // Chain pair seeded in buildFixture sits at the top of today's
      // history, so no scrolling is needed. Just give the renderer a
      // beat to settle.
      await sleep(150);
      break;

    case 'chain-bottle':
      // The chain-bottle prompt fires after stopping a real-feed breast
      // session. Easiest reliable path is to show it directly.
      document.getElementById('chainSub').textContent =
        'Combination feeding? Start a bottle now in one tap.';
      document.getElementById('chainBottleModal').classList.remove('hidden');
      break;

    default:
      console.warn('[fixture] unknown capture mode:', mode);
  }

  // Mark ready so an external screenshotter can poll for this attribute.
  document.documentElement.setAttribute('data-capture-ready', mode);
}

window.runCapture = runCapture;
