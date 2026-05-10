// ----- Storage keys (per-device) -----
const LS = {
  apiUrl: 'feedmeter.apiUrl',
  passcode: 'feedmeter.passcode',
  user: 'feedmeter.user',
  cache: 'feedmeter.cache.v2',     // entries + settings + users
  active: 'feedmeter.active.v2',   // legacy: pre-sync local-only running session
};

// How often to re-fetch state while the tab is visible (active sessions sync).
const POLL_INTERVAL_MS = 30 * 1000;

// ----- Type metadata -----
const TYPE_META = {
  left:   { title: 'Left breast',  short: 'Left',   needsVolume: false, needsSource: false, isFeed: true  },
  right:  { title: 'Right breast', short: 'Right',  needsVolume: false, needsSource: false, isFeed: true  },
  bottle: { title: 'Bottle',       short: 'Bottle', needsVolume: true,  needsSource: true,  isFeed: true  },
  pump:   { title: 'Pump',         short: 'Pump',   needsVolume: true,  needsSource: false, isFeed: false },
};

// ----- DOM helpers -----
const $ = (id) => document.getElementById(id);
const grid = $('actionGrid');
const entriesEl = $('entries');
const emptyState = $('emptyState');
const stopModal = $('stopModal');
const editModal = $('editModal');
const setupModal = $('setupModal');
const userModal = $('userModal');
const settingsModal = $('settingsModal');
const comfortModal = $('comfortModal');
const weightModal = $('weightModal');
const formulaLimitModal = $('formulaLimitModal');
const chainBottleModal = $('chainBottleModal');
const syncBanner = $('syncBanner');
const userChip = $('userChip');

// ----- State -----
let state = {
  apiUrl: localStorage.getItem(LS.apiUrl) || '',
  passcode: localStorage.getItem(LS.passcode) || '',
  user: localStorage.getItem(LS.user) || '',
  entries: [],
  users: [],
  weights: [],
  settings: { feedingIntervalMin: 180 },
  historyDate: null, // YYYY-MM-DD or null = today (live)
  statsOffset: 0,    // 0 = last 24h ending now, 1 = previous 24h, ...
};
let activeTab = 'feedings';
let editingWeightId = null;
let pendingSave = null;
let editingId = null;
let pendingComfort = null;  // entry held for comfort-feeding prompt
let pendingConflictNewType = null; // pending start type while conflict modal is open
let activeCreatePromise = null; // in-flight add-entry for the active session
let tickHandle = null;
let metricsHandle = null;
let pollHandle = null;

// Try to hydrate from local cache (snappy first paint, even offline)
try {
  const cached = JSON.parse(localStorage.getItem(LS.cache) || 'null');
  if (cached) {
    if (Array.isArray(cached.entries)) state.entries = cached.entries;
    if (Array.isArray(cached.users)) state.users = cached.users;
    if (Array.isArray(cached.weights)) state.weights = cached.weights;
    if (cached.settings && typeof cached.settings === 'object') {
      Object.assign(state.settings, cached.settings);
    }
  }
} catch {}

// One-time migration from the old local-only `active` storage to a real
// entry that lives in `state.entries` (and will be pushed to the server on
// the next bootstrap).
try {
  const legacy = JSON.parse(localStorage.getItem(LS.active) || 'null');
  if (legacy && legacy.type && legacy.start) {
    state.entries.push({
      id: cryptoId(),
      type: legacy.type,
      start: legacy.start,
      end: null,
      user: state.user || null,
      volume: null,
      source: null,
      isComfort: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pending: true,
      _pendingCreate: true,
    });
    saveCache();
  }
} catch {}
localStorage.removeItem(LS.active);

// ----- Boot -----
init();

async function init() {
  bindEvents();
  render();

  if (!state.apiUrl || !state.passcode) {
    openSetup();
    return;
  }
  try {
    await bootstrap();
  } catch (err) {
    flashSync('Cannot reach sheet: ' + err.message, 'error');
  }
  if (!state.user) {
    openSetup({ step: 'name' });
  }
  if (getActiveEntry()) startTick();
  startMetricsTick();
  startPoll();
}

// ----- Event wiring -----
function bindEvents() {
  // Tile click: tap the running tile to stop, tap any other tile to start
  // (which may open the conflict modal if a session is already running).
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const action = tile.dataset.action;
    const activeEntry = getActiveEntry();
    if (activeEntry && activeEntry.type === action) {
      stopSession();
    } else {
      if (!ensureReady()) return;
      startSession(action);
    }
  });

  // Setup wizard
  $('setupConnect').addEventListener('click', connectSetup);
  $('setupPasscode').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectSetup(); });
  $('setupUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectSetup(); });
  $('setupAddUserBtn').addEventListener('click', addSetupUser);
  $('setupNewUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSetupUser(); });
  $('setupBackBtn').addEventListener('click', () => showSetupStep('connect'));

  // Header
  $('settingsBtn').addEventListener('click', openSettings);
  userChip.addEventListener('click', openUserPicker);

  // History day picker
  $('dayPick').addEventListener('click', openDayPicker);
  $('dayInput').addEventListener('change', onDayPicked);
  $('backToToday').addEventListener('click', () => {
    state.historyDate = null;
    render();
  });
  $('dayPrev').addEventListener('click', () => stepDay(-1));
  $('dayNext').addEventListener('click', () => stepDay(+1));

  // Top-stats sliding-window stepper (independent from history day-nav).
  // `‹` walks into the past (older 24h slice), `›` walks back toward now.
  $('statsPrev').addEventListener('click', () => stepStatsWindow(+1));
  $('statsNext').addEventListener('click', () => stepStatsWindow(-1));
  $('statsNow').addEventListener('click', () => {
    if (state.statsOffset === 0) return;
    state.statsOffset = 0;
    tickMetrics();
  });

  // User picker
  $('addUserBtn').addEventListener('click', addNewUser);
  $('newUserInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNewUser(); });
  $('userCancelBtn').addEventListener('click', () => hideModal(userModal));
  $('resetSetupBtn').addEventListener('click', () => {
    if (!confirm('Disconnect this device? You will need to enter the URL and passcode again. Data in the sheet stays.')) return;
    localStorage.removeItem(LS.apiUrl);
    localStorage.removeItem(LS.passcode);
    localStorage.removeItem(LS.user);
    state.apiUrl = state.passcode = state.user = '';
    hideModal(userModal);
    openSetup();
  });

  // Settings
  $('settingsCancel').addEventListener('click', () => hideModal(settingsModal));
  $('settingsSave').addEventListener('click', saveSettings);
  $('exportBtn').addEventListener('click', exportData);

  // Stop modal (bottle/pump)
  $('cancelSave').addEventListener('click', () => { pendingSave = null; hideModal(stopModal); });
  $('saveBtn').addEventListener('click', confirmSave);
  stopModal.querySelectorAll('[data-source]').forEach(b => {
    b.addEventListener('click', () => {
      stopModal.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  // Edit modal
  editModal.querySelectorAll('[data-edit-source]').forEach(b => {
    b.addEventListener('click', () => {
      editModal.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  $('cancelEdit').addEventListener('click', () => { editingId = null; hideModal(editModal); });
  $('saveEdit').addEventListener('click', confirmEdit);
  $('deleteEntry').addEventListener('click', confirmDelete);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Weight modal
  $('logWeightBtn').addEventListener('click', () => openWeightModal());
  $('cancelWeightBtn').addEventListener('click', () => hideModal(weightModal));
  $('saveWeightBtn').addEventListener('click', saveWeight);
  $('deleteWeightBtn').addEventListener('click', confirmDeleteWeight);
  weightModal.querySelectorAll('[data-wtiming]').forEach(b => {
    b.addEventListener('click', () => {
      weightModal.querySelectorAll('[data-wtiming]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  weightModal.addEventListener('click', (e) => { if (e.target === weightModal) hideModal(weightModal); });

  // Comfort feeding modal
  $('comfortRealBtn').addEventListener('click', () => resolveComfort(false));
  $('comfortOnlyBtn').addEventListener('click', () => resolveComfort(true));
  comfortModal.addEventListener('click', (e) => {
    if (e.target === comfortModal) resolveComfort(false); // backdrop = real feeding
  });

  // Formula limit warning modal
  $('formulaLimitOk').addEventListener('click', () => {
    hideModal(formulaLimitModal);
    beginSession('bottle');
  });
  $('formulaLimitCancel').addEventListener('click', () => hideModal(formulaLimitModal));
  formulaLimitModal.addEventListener('click', (e) => {
    if (e.target === formulaLimitModal) hideModal(formulaLimitModal); // backdrop = cancel
  });

  // Chain-bottle modal (offered after a breast feed)
  $('chainBottleYesBtn').addEventListener('click', () => {
    hideModal(chainBottleModal);
    // Use startSession (not beginSession) so the formula-limit warning
    // and any newly-detected conflict still apply to the chained bottle.
    startSession('bottle');
  });
  $('chainBottleNoBtn').addEventListener('click', () => hideModal(chainBottleModal));
  chainBottleModal.addEventListener('click', (e) => {
    if (e.target === chainBottleModal) hideModal(chainBottleModal); // backdrop = no
  });

  // Active session conflict modal
  $('conflictContinue').addEventListener('click', () => {
    pendingConflictNewType = null;
    hideModal($('activeConflictModal'));
  });
  $('conflictStopStart').addEventListener('click', () => onConflictResolve('stop'));
  $('conflictDiscardStart').addEventListener('click', () => onConflictResolve('discard'));
  $('activeConflictModal').addEventListener('click', (e) => {
    if (e.target === $('activeConflictModal')) {
      pendingConflictNewType = null;
      hideModal($('activeConflictModal'));
    }
  });

  // Backdrop close
  [stopModal, editModal, settingsModal, userModal].forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) {
        if (m === stopModal) pendingSave = null;
        if (m === editModal) editingId = null;
        hideModal(m);
      }
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (getActiveEntry()) tickNow();
      tickMetrics();
      if (state.apiUrl && state.passcode) bootstrap().catch(() => {});
    }
  });
}

function ensureReady() {
  if (!state.apiUrl || !state.passcode) { openSetup(); return false; }
  if (!state.user) { openUserPicker(); return false; }
  return true;
}

// ----- API client -----

async function api(action, payload = {}) {
  if (!state.apiUrl) throw new Error('Not configured');
  const body = JSON.stringify({ action, passcode: state.passcode, user: state.user || null, ...payload });
  const res = await fetch(state.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let data;
  try { data = await res.json(); }
  catch { throw new Error('Bad response from server'); }
  if (!data.ok) throw new Error(data.error || 'Server error');
  return data;
}

async function bootstrap() {
  const data = await api('bootstrap');
  // Preserve local pending entries (start not yet ack'd by the server) so
  // that a slow or failed network round-trip doesn't drop the live session.
  const pendingById = {};
  for (const e of state.entries) {
    if (e.pending || e._pendingCreate) pendingById[e.id] = e;
  }
  state.entries = (data.entries || []).map(e => ({ ...e, pending: false }));
  for (const id of Object.keys(pendingById)) {
    if (!state.entries.some(e => e.id === id)) state.entries.push(pendingById[id]);
  }
  state.users = data.users || [];
  state.weights = data.weights || [];
  state.settings = Object.assign({ feedingIntervalMin: 180 }, data.settings || {});
  saveCache();
  render();
  if (activeTab === 'weight') renderWeightTab();
  // Best-effort: re-push any entries whose original add-entry never landed.
  retryPendingCreates();
  return data;
}

async function retryPendingCreates() {
  // Wait for any in-flight create from beginSession to settle first.
  // Otherwise a poll-triggered bootstrap whose snapshot was taken before
  // that create landed would fire a second add-entry for the same id while
  // the first is still in flight — producing two rows in the sheet with
  // the same id (one orphaned as a permanently-"live" ghost session).
  if (activeCreatePromise) { try { await activeCreatePromise; } catch {} }
  const pending = state.entries.filter(e => e._pendingCreate);
  if (!pending.length) return;
  for (const e of pending) {
    try {
      const data = await api('add-entry', { entry: stripLocalFlags(e) });
      const i = state.entries.findIndex(x => x.id === data.entry.id);
      if (i >= 0) state.entries[i] = { ...data.entry, pending: false };
    } catch {
      // still offline / server error; will retry on next bootstrap
    }
  }
  saveCache();
  render();
}

function stripLocalFlags(e) {
  const out = {};
  for (const k of Object.keys(e)) {
    if (k === 'pending' || k === '_pendingCreate') continue;
    out[k] = e[k];
  }
  return out;
}

function saveCache() {
  localStorage.setItem(LS.cache, JSON.stringify({
    entries: state.entries,
    users: state.users,
    weights: state.weights,
    settings: state.settings,
  }));
}

// ----- Tabs -----

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('tabFeedings').classList.toggle('hidden', tab !== 'feedings');
  $('tabWeight').classList.toggle('hidden', tab !== 'weight');
  if (tab === 'weight') renderWeightTab();
}

// ----- Weight tab -----

function renderWeightTab() {
  const sorted = [...state.weights].sort((a, b) => b.date.localeCompare(a.date));
  renderWeightChart([...sorted].reverse()); // oldest→newest for chart
  renderWeightList(sorted);
}

function renderWeightChart(chronological) {
  const container = $('weightChart');
  const birthW = Number(state.settings.birthWeightG) || 0;

  if (!chronological.length) {
    container.innerHTML = birthW
      ? `<p class="weight-birth-only">Birth weight: <strong>${(birthW / 1000).toFixed(3)} kg</strong></p>`
      : '';
    return;
  }

  const W = 340, H = 170;
  const PAD = { top: 16, right: 38, bottom: 28, left: 46 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const values = chronological.map(w => w.weightG);
  const allValues = birthW ? [...values, birthW] : values;
  let minV = Math.min(...allValues);
  let maxV = Math.max(...allValues);
  const spread = maxV - minV || 200;
  minV = Math.max(0, minV - spread * 0.18);
  maxV = maxV + spread * 0.18;
  const range = maxV - minV;

  const xOf = i => PAD.left + (chronological.length > 1 ? (i / (chronological.length - 1)) * chartW : chartW / 2);
  const yOf = g => PAD.top + (1 - (g - minV) / range) * chartH;

  const yTicks = [minV + range * 0.15, minV + range * 0.5, minV + range * 0.85];
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="weight-chart-svg">`;

  // Y grid + labels
  for (const g of yTicks) {
    const y = yOf(g).toFixed(1);
    svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" class="chart-grid"/>`;
    svg += `<text x="${PAD.left - 4}" y="${(parseFloat(y) + 4).toFixed(1)}" class="chart-label-y">${(g / 1000).toFixed(2)}</text>`;
  }

  // Birth weight baseline
  if (birthW) {
    const by = yOf(birthW).toFixed(1);
    svg += `<line x1="${PAD.left}" y1="${by}" x2="${W - PAD.right}" y2="${by}" class="chart-birth"/>`;
    svg += `<text x="${W - PAD.right - 3}" y="${(parseFloat(by) - 4).toFixed(1)}" class="chart-label-birth" text-anchor="end">birth</text>`;
  }

  // Connecting line
  if (chronological.length > 1) {
    const pts = chronological.map((w, i) => `${xOf(i).toFixed(1)},${yOf(w.weightG).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" class="chart-line"/>`;
  }

  // Dots
  chronological.forEach((w, i) => {
    const cx = xOf(i).toFixed(1), cy = yOf(w.weightG).toFixed(1);
    const cls = w.timing === 'before' ? 'chart-dot-before' : 'chart-dot-after';
    svg += `<circle cx="${cx}" cy="${cy}" r="5" class="chart-dot ${cls}" data-wid="${w.id}"/>`;
  });

  // X labels (up to 4 evenly spaced)
  const n = chronological.length;
  const idxs = n <= 4
    ? chronological.map((_, i) => i)
    : [...new Set([0, Math.floor(n / 3), Math.floor(2 * n / 3), n - 1])];
  for (const i of idxs) {
    const d = new Date(chronological[i].date + 'T12:00:00');
    const lbl = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    svg += `<text x="${xOf(i).toFixed(1)}" y="${H - 4}" class="chart-label-x" text-anchor="middle">${escapeHtml(lbl)}</text>`;
  }

  svg += '</svg>';
  container.innerHTML = svg;
  container.querySelectorAll('.chart-dot').forEach(dot => {
    dot.addEventListener('click', () => openWeightModal(dot.dataset.wid));
  });
}

function renderWeightList(sortedDesc) {
  const list = $('weightEntries');
  const empty = $('weightEmpty');
  list.innerHTML = '';
  if (!sortedDesc.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  sortedDesc.slice(0, 30).forEach(w => {
    const li = document.createElement('li');
    li.className = 'weight-entry';
    li.tabIndex = 0;
    li.addEventListener('click', () => openWeightModal(w.id));
    const d = new Date(w.date + 'T12:00:00');
    const dateStr = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const timingLabel = w.timing === 'before' ? 'before feed' : 'after feed';
    li.innerHTML = `
      <span class="weight-entry-date">${escapeHtml(dateStr)}</span>
      <span class="weight-entry-val">${(w.weightG / 1000).toFixed(3)} kg</span>
      <span class="weight-timing-tag ${w.timing}">${timingLabel}</span>
    `;
    list.appendChild(li);
  });
}

function openWeightModal(id) {
  hideError($('weightError'));
  weightModal.querySelectorAll('[data-wtiming]').forEach(b => b.classList.remove('active'));
  if (id) {
    const w = state.weights.find(x => x.id === id);
    if (!w) return;
    editingWeightId = id;
    $('weightModalTitle').textContent = 'Edit weight';
    $('weightInput').value = w.weightG;
    $('weightDate').value = w.date;
    (weightModal.querySelector(`[data-wtiming="${w.timing}"]`) || weightModal.querySelector('[data-wtiming="after"]')).classList.add('active');
    $('deleteWeightBtn').classList.remove('hidden');
  } else {
    editingWeightId = null;
    $('weightModalTitle').textContent = 'Log weight';
    $('weightInput').value = '';
    $('weightDate').value = todayKey();
    weightModal.querySelector('[data-wtiming="after"]').classList.add('active');
    $('deleteWeightBtn').classList.add('hidden');
  }
  showModal(weightModal);
  setTimeout(() => $('weightInput').focus(), 120);
}

async function saveWeight() {
  hideError($('weightError'));
  const g = parseInt($('weightInput').value, 10);
  if (isNaN(g) || g < 500 || g > 15000) return showError($('weightError'), 'Enter a valid weight (500–15000 g)');
  const date = $('weightDate').value;
  if (!date) return showError($('weightError'), 'Date required');
  const timing = weightModal.querySelector('[data-wtiming].active')?.dataset.wtiming || 'after';
  try {
    setBusy($('saveWeightBtn'), true);
    let data;
    if (editingWeightId) {
      data = await api('update-weight', { weight: { id: editingWeightId, weightG: g, date, timing } });
      const idx = state.weights.findIndex(w => w.id === editingWeightId);
      if (idx >= 0) state.weights[idx] = data.weight;
    } else {
      data = await api('add-weight', { weight: { weightG: g, date, timing } });
      state.weights.push(data.weight);
    }
    saveCache();
    hideModal(weightModal);
    editingWeightId = null;
    renderWeightTab();
    flashSync('Saved', 'ok');
  } catch (err) {
    showError($('weightError'), err.message);
  } finally {
    setBusy($('saveWeightBtn'), false);
  }
}

async function confirmDeleteWeight() {
  if (!editingWeightId) return;
  if (!confirm('Delete this weight entry?')) return;
  const id = editingWeightId;
  try {
    await api('delete-weight', { id });
    state.weights = state.weights.filter(w => w.id !== id);
    saveCache();
    hideModal(weightModal);
    editingWeightId = null;
    renderWeightTab();
    flashSync('Deleted', 'ok');
  } catch (err) {
    flashSync('Could not delete: ' + err.message, 'error');
  }
}

// ----- Setup wizard -----

function openSetup(opts = {}) {
  const step = opts.step || 'connect';
  hideError($('setupError'));
  hideError($('setupUserError'));
  if (step === 'connect') {
    $('setupUrl').value = state.apiUrl || '';
    $('setupPasscode').value = '';
  } else {
    $('setupNewUser').value = '';
    renderSetupUserList();
  }
  showSetupStep(step);
  showModal(setupModal);
  setTimeout(() => {
    if (step === 'connect') $('setupUrl').focus();
    else $('setupNewUser').focus();
  }, 120);
}

function showSetupStep(step) {
  setupModal.querySelectorAll('.setup-step').forEach(el => {
    el.classList.toggle('hidden', el.dataset.step !== step);
  });
}

async function connectSetup() {
  const url = $('setupUrl').value.trim();
  const pass = $('setupPasscode').value.trim();
  hideError($('setupError'));
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec\b/.test(url)) {
    return showError($('setupError'), 'URL should look like https://script.google.com/macros/s/.../exec');
  }
  if (!pass) {
    return showError($('setupError'), 'Passcode required');
  }
  state.apiUrl = url;
  state.passcode = pass;
  try {
    setBusy($('setupConnect'), true);
    await bootstrap();
  } catch (err) {
    setBusy($('setupConnect'), false);
    state.apiUrl = state.passcode = '';
    return showError($('setupError'), err.message);
  }
  setBusy($('setupConnect'), false);
  localStorage.setItem(LS.apiUrl, state.apiUrl);
  localStorage.setItem(LS.passcode, state.passcode);
  if (state.user) {
    hideModal(setupModal);
  } else {
    renderSetupUserList();
    showSetupStep('name');
    setTimeout(() => $('setupNewUser').focus(), 100);
  }
}

function renderSetupUserList() {
  const list = $('setupUserList');
  list.innerHTML = '';
  if (!state.users.length) {
    list.innerHTML = '<p class="empty small">No users yet. Add one below.</p>';
    return;
  }
  state.users.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'user-pick' + (name === state.user ? ' active' : '');
    btn.innerHTML = `
      <span class="user-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</span>
      <span class="user-name">${escapeHtml(name)}</span>
    `;
    btn.addEventListener('click', () => pickSetupUser(name));
    list.appendChild(btn);
  });
}

function pickSetupUser(name) {
  state.user = name;
  localStorage.setItem(LS.user, name);
  hideModal(setupModal);
  showSetupStep('connect'); // reset for next time
  render();
}

async function addSetupUser() {
  const name = $('setupNewUser').value.trim();
  hideError($('setupUserError'));
  if (!name) return;
  try {
    setBusy($('setupAddUserBtn'), true);
    const data = await api('add-user', { name });
    state.users = data.users || [];
    saveCache();
    pickSetupUser(name);
  } catch (err) {
    showError($('setupUserError'), err.message);
  } finally {
    setBusy($('setupAddUserBtn'), false);
  }
}

// ----- User picker -----

function openUserPicker() {
  hideError($('userError'));
  $('newUserInput').value = '';
  renderUserList();
  showModal(userModal);
}

function renderUserList() {
  const list = $('userList');
  list.innerHTML = '';
  if (!state.users.length) {
    list.innerHTML = '<p class="empty small">No users yet. Add one below.</p>';
    return;
  }
  state.users.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'user-pick' + (name === state.user ? ' active' : '');
    btn.innerHTML = `
      <span class="user-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</span>
      <span class="user-name">${escapeHtml(name)}</span>
    `;
    btn.addEventListener('click', () => pickUser(name));
    list.appendChild(btn);
  });
}

function pickUser(name) {
  state.user = name;
  localStorage.setItem(LS.user, name);
  hideModal(userModal);
  render();
}

async function addNewUser() {
  const name = $('newUserInput').value.trim();
  hideError($('userError'));
  if (!name) return;
  try {
    setBusy($('addUserBtn'), true);
    const data = await api('add-user', { name });
    state.users = data.users || [];
    saveCache();
    renderUserList();
    pickUser(name);
  } catch (err) {
    showError($('userError'), err.message);
  } finally {
    setBusy($('addUserBtn'), false);
  }
}

// ----- Settings -----

function openSettings() {
  if (!state.apiUrl || !state.passcode) return openSetup();
  hideError($('settingsError'));
  $('settingFeed').value = state.settings.feedingIntervalMin || '';
  $('settingMinDuration').value = state.settings.minFeedDurationMin ?? '';
  $('settingMinVolume').value = state.settings.minBottleVolumeMl ?? '';
  $('settingFormulaLimit').value = state.settings.dailyFormulaLimitMl || '';
  // 0/empty/undefined → blank (= grouping off). Any positive number shows as-is.
  $('settingMergeGap').value = state.settings.mergeMaxGapMin || '';
  $('settingBirthWeight').value = state.settings.birthWeightG || '';
  // Default on: only off when explicitly set to false in the sheet.
  $('settingOfferBottleChain').checked = state.settings.offerBottleChain !== false;
  showModal(settingsModal);
}

async function saveSettings() {
  hideError($('settingsError'));
  const feed = parseInt($('settingFeed').value, 10);
  if (isNaN(feed) || feed < 30) return showError($('settingsError'), 'Feeding interval must be ≥ 30');
  const minDur = $('settingMinDuration').value === '' ? null : parseInt($('settingMinDuration').value, 10);
  const minVol = $('settingMinVolume').value === '' ? null : parseInt($('settingMinVolume').value, 10);
  // Empty input persists 0 (= no limit) so the user can actually clear it.
  const formulaLimitRaw = $('settingFormulaLimit').value;
  const formulaLimit = formulaLimitRaw === '' ? 0 : Math.max(0, parseInt(formulaLimitRaw, 10) || 0);
  // Same convention for merge gap: empty → 0 → grouping off.
  const mergeGapRaw = $('settingMergeGap').value;
  const mergeGap = mergeGapRaw === '' ? 0 : Math.max(0, parseInt(mergeGapRaw, 10) || 0);
  try {
    setBusy($('settingsSave'), true);
    const birthW = $('settingBirthWeight').value === '' ? null : parseInt($('settingBirthWeight').value, 10);
    const patch = { feedingIntervalMin: feed, dailyFormulaLimitMl: formulaLimit, mergeMaxGapMin: mergeGap };
    if (minDur !== null) patch.minFeedDurationMin = minDur;
    if (minVol !== null) patch.minBottleVolumeMl = minVol;
    if (birthW !== null && !isNaN(birthW)) patch.birthWeightG = birthW;
    patch.offerBottleChain = $('settingOfferBottleChain').checked;
    const data = await api('update-settings', { settings: patch });
    state.settings = Object.assign(state.settings, data.settings || {});
    saveCache();
    hideModal(settingsModal);
    render();
    if (activeTab === 'weight') renderWeightTab();
  } catch (err) {
    showError($('settingsError'), err.message);
  } finally {
    setBusy($('settingsSave'), false);
  }
}

// ----- Sessions -----

// Active session = the most recent non-deleted entry that has no end yet.
// Source of truth is `state.entries` (synced via bootstrap), so all devices
// agree on whether a session is currently running.
function getActiveEntry() {
  let best = null;
  for (const e of state.entries) {
    if (e.deleted) continue;
    if (e.end != null) continue;
    if (!best || (e.start || 0) > (best.start || 0)) best = e;
  }
  return best;
}

// Group consecutive feed entries (left/right/bottle) whose end-to-start
// gap stays within `maxGapMin` minutes. Each result is a chain in
// start-ascending order. A 1-element result is a "lone" entry (no
// neighbours within the gap) and renders standalone in the UI.
//
// Pump entries are NEVER grouped (not feeding for the baby) and should
// be excluded by the caller. Comfort feedings DO participate in the
// visual chain (per the user spec) — but the countdown anchor uses the
// earliest *non-comfort* member to avoid a leading comfort feed shifting
// the timer artificially. A live (no-end) entry can join a chain as the
// last member, but never as a non-last member (since nothing can come
// after a session that hasn't ended).
function buildChains(entries, maxGapMin) {
  const sorted = entries
    .filter(e => e && !e.deleted && e.start != null)
    .slice()
    .sort((a, b) => a.start - b.start);
  if (!maxGapMin || maxGapMin <= 0) return sorted.map(e => [e]);
  const maxGapMs = maxGapMin * 60 * 1000;
  const chains = [];
  let current = null;
  for (const e of sorted) {
    if (!current) { current = [e]; continue; }
    const prev = current[current.length - 1];
    if (prev.end == null || (e.start - prev.end) > maxGapMs) {
      chains.push(current);
      current = [e];
    } else {
      current.push(e);
    }
  }
  if (current) chains.push(current);
  return chains;
}

// Pull just the feed entries (no pumps) from a list — convenience for
// chain building.
function feedEntriesOnly(entries) {
  return entries.filter(e => e.type === 'left' || e.type === 'right' || e.type === 'bottle');
}

// Find the chain that contains `lastFeed` and return the start time the
// "Next feeding" countdown should anchor on: the earliest non-comfort
// member's start. When grouping is off (or the chain doesn't exist),
// falls back to lastFeed.start — i.e. current behaviour.
function chainAnchorStart(lastFeed, maxGapMin) {
  if (!lastFeed) return 0;
  if (!maxGapMin || maxGapMin <= 0) return lastFeed.start || 0;
  const chains = buildChains(feedEntriesOnly(state.entries), maxGapMin);
  const chain = chains.find(c => c.some(e => e.id === lastFeed.id));
  if (!chain) return lastFeed.start || 0;
  const firstReal = chain.find(e => !e.isComfort);
  return (firstReal || lastFeed).start || 0;
}

function startSession(type) {
  if (type === 'bottle' && shouldWarnFormulaLimit()) {
    openFormulaLimitWarning();
    return;
  }
  const conflict = getActiveEntry();
  if (conflict) {
    openActiveConflictModal(conflict, type);
    return;
  }
  beginSession(type);
}

// Optimistically create the active entry locally and push to the server in
// the background. Stop/complete will await the in-flight create so it can
// safely call update-entry once the row exists, or fall back to add-entry
// if the original create never landed.
function beginSession(type) {
  if (getActiveEntry()) return;
  const id = cryptoId();
  const start = Date.now();
  const nowIso = new Date().toISOString();
  const entry = {
    id,
    type,
    start,
    end: null,
    user: state.user || null,
    volume: null,
    source: null,
    isComfort: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    pending: true,
    _pendingCreate: true,
  };
  state.entries.push(entry);
  saveCache();
  startTick();
  render();

  activeCreatePromise = (async () => {
    try {
      const data = await api('add-entry', { entry: stripLocalFlags(entry) });
      const i = state.entries.findIndex(x => x.id === id);
      if (i >= 0) state.entries[i] = { ...data.entry, pending: false };
      saveCache();
      render();
    } catch (err) {
      flashSync('Start kept locally: ' + err.message, 'error');
    } finally {
      activeCreatePromise = null;
    }
  })();
}

function todayFormulaMl() {
  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  let total = 0;
  for (const e of state.entries) {
    if (e.type !== 'bottle') continue;
    if (e.isComfort) continue;
    if (e.source !== 'formula') continue;
    if ((e.start || 0) < todayStart) continue;
    if (e.volume) total += e.volume;
  }
  return total;
}

function shouldWarnFormulaLimit() {
  const limit = Number(state.settings.dailyFormulaLimitMl) || 0;
  if (limit <= 0) return false;
  return todayFormulaMl() >= limit;
}

function openFormulaLimitWarning() {
  const limit = Number(state.settings.dailyFormulaLimitMl) || 0;
  const current = todayFormulaMl();
  $('formulaLimitMsg').textContent =
    `Today's formula is already at the daily limit (${current} ml of ${limit} ml).`;
  showModal(formulaLimitModal);
}

function openActiveConflictModal(activeEntry, newType) {
  pendingConflictNewType = newType;
  const meta = TYPE_META[activeEntry.type] || { title: activeEntry.type };
  const newMeta = TYPE_META[newType] || { title: newType };
  const dur = formatDuration(Date.now() - (activeEntry.start || Date.now()));
  const who = activeEntry.user && activeEntry.user !== state.user
    ? ` by ${activeEntry.user}`
    : '';
  $('conflictMsg').textContent =
    `${meta.title} is running${who} — ${dur} so far. To start ${newMeta.title.toLowerCase()}, choose what to do with the running session.`;
  showModal($('activeConflictModal'));
}

async function onConflictResolve(action) {
  const newType = pendingConflictNewType;
  pendingConflictNewType = null;
  hideModal($('activeConflictModal'));
  if (!newType) return;
  const activeEntry = getActiveEntry();
  if (activeEntry) {
    if (activeCreatePromise) { try { await activeCreatePromise; } catch {} }
    if (action === 'stop') {
      // Save as-is: keep whatever volume/source the entry already has, just
      // close it with end=now. Bottle/pump entries closed this way get no
      // volume prompt — the user can edit later from history.
      await completeEntry({ ...activeEntry, end: Date.now() });
    } else if (action === 'discard') {
      await discardActiveEntry(activeEntry);
    }
  }
  beginSession(newType);
}

async function stopSession() {
  // Guard against re-entry: a modal-driven stop is already in flight, so a
  // second tap on the still-active tile would just open another modal.
  if (pendingSave || pendingComfort) return;
  const activeEntry = getActiveEntry();
  if (!activeEntry) return;
  if (activeCreatePromise) { try { await activeCreatePromise; } catch {} }
  const end = Date.now();
  const meta = TYPE_META[activeEntry.type];

  if (!meta.needsVolume && !meta.needsSource) {
    const durationSec = (end - activeEntry.start) / 1000;
    const minDurationSec = (Number(state.settings.minFeedDurationMin) || 0) * 60;
    if (meta.isFeed && minDurationSec > 0 && durationSec < minDurationSec) {
      pendingComfort = { ...activeEntry, end, volume: null, source: null };
      // Pre-emptively stop the local timer so the tile reflects "stopped";
      // the entry stays without an end until comfort is resolved.
      stopTick();
      openComfortModal(`${meta.title} · ${formatDuration(end - activeEntry.start)}`);
      return;
    }
    await completeEntry({ ...activeEntry, end, isComfort: false });
    maybeOfferBottleChain(activeEntry.type);
    return;
  }

  pendingSave = { ...activeEntry, end };
  stopTick();
  openSaveModal(pendingSave);
}

async function confirmSave() {
  if (!pendingSave) return hideModal(stopModal);
  const meta = TYPE_META[pendingSave.type];
  const volume = parseInt($('volumeInput').value, 10);
  const source = stopModal.querySelector('.seg-btn.active')?.dataset.source || null;
  if (meta.needsVolume && (isNaN(volume) || volume < 0)) return flashField($('volumeInput'));
  if (meta.needsSource && !source) return flashField(stopModal.querySelector('.seg'));

  const entry = {
    ...pendingSave,
    volume: meta.needsVolume ? volume : null,
    source: meta.needsSource ? source : null,
  };

  // Check bottle volume threshold
  const minVolumeMl = Number(state.settings.minBottleVolumeMl) || 0;
  if (meta.isFeed && meta.needsVolume && minVolumeMl > 0 && volume < minVolumeMl) {
    pendingComfort = entry;
    pendingSave = null;
    hideModal(stopModal);
    openComfortModal(`Bottle · ${volume} ml`);
    return;
  }

  pendingSave = null;
  hideModal(stopModal);
  await completeEntry({ ...entry, isComfort: false });
}

// Optimistically apply local changes, then sync. If the server never saw
// this entry before (still _pendingCreate), use add-entry to create+complete
// in one go; otherwise update the existing row.
async function completeEntry(entry) {
  const idx = state.entries.findIndex(e => e.id === entry.id);
  const prev = idx >= 0 ? state.entries[idx] : null;
  const merged = { ...(prev || {}), ...entry, pending: true };
  if (idx >= 0) state.entries[idx] = merged;
  else state.entries.push(merged);
  stopTick();
  saveCache();
  render();

  const useCreate = !!(prev && prev._pendingCreate);
  try {
    const action = useCreate ? 'add-entry' : 'update-entry';
    const data = await api(action, { entry: stripLocalFlags(merged) });
    const i = state.entries.findIndex(e => e.id === data.entry.id);
    if (i >= 0) state.entries[i] = { ...data.entry, pending: false };
    saveCache();
    render();
    flashSync('Saved', 'ok');
  } catch (err) {
    flashSync('Could not sync: ' + err.message + ' (kept locally)', 'error');
  }
}

async function discardActiveEntry(activeEntry) {
  const id = activeEntry.id;
  const wasOnServer = !activeEntry._pendingCreate;
  state.entries = state.entries.filter(e => e.id !== id);
  stopTick();
  saveCache();
  render();
  if (!wasOnServer) return;
  try {
    await api('delete-entry', { id });
  } catch (err) {
    flashSync('Could not sync discard: ' + err.message, 'error');
  }
}

function startTick() { stopTick(); tickNow(); tickHandle = setInterval(tickNow, 1000); }
function stopTick() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }
function tickNow() {
  const a = getActiveEntry();
  if (!a) { stopTick(); return; }
  const elapsed = Date.now() - a.start;
  const text = formatDuration(elapsed);
  const tile = grid.querySelector(`.tile[data-action="${a.type}"]`);
  if (tile) tile.querySelector('.live-timer').textContent = text;
}

function startPoll() {
  stopPoll();
  pollHandle = setInterval(() => {
    if (document.hidden) return;
    if (!state.apiUrl || !state.passcode) return;
    bootstrap().catch(() => {});
  }, POLL_INTERVAL_MS);
}
function stopPoll() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }

// ----- Edit modal -----

function openEditModal(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  const meta = TYPE_META[e.type];
  $('editTitle').textContent = `Edit · ${meta.title}`;
  $('editStart').value = toLocalDatetime(e.start);
  $('editEnd').value = toLocalDatetime(e.end);
  $('editSourceField').classList.toggle('hidden', !meta.needsSource);
  $('editVolumeField').classList.toggle('hidden', !meta.needsVolume);
  $('editVolume').value = e.volume ?? '';
  $('editComfortField').classList.toggle('hidden', !meta.isFeed);
  $('editIsComfort').checked = !!e.isComfort;
  editModal.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  if (meta.needsSource && e.source) {
    editModal.querySelector(`[data-edit-source="${e.source}"]`)?.classList.add('active');
  }
  showModal(editModal);
}

async function confirmEdit() {
  if (!editingId) return;
  const idx = state.entries.findIndex(x => x.id === editingId);
  if (idx < 0) return;
  const e = state.entries[idx];
  const meta = TYPE_META[e.type];
  const startMs = new Date($('editStart').value).getTime();
  // Allow saving with no end (keeps the entry as an active session). When
  // an end is provided it must come after the start.
  const rawEnd = $('editEnd').value;
  const endMs = rawEnd ? new Date(rawEnd).getTime() : null;
  if (isNaN(startMs)) return flashField($('editStart'));
  if (endMs !== null && (isNaN(endMs) || endMs < startMs)) return flashField($('editEnd'));

  const next = {
    ...e,
    start: startMs,
    end: endMs,
    volume: meta.needsVolume ? (parseInt($('editVolume').value, 10) || null) : null,
    source: meta.needsSource ? (editModal.querySelector('.seg-btn.active')?.dataset.editSource || e.source) : null,
    isComfort: meta.isFeed ? $('editIsComfort').checked : false,
  };
  state.entries[idx] = { ...next, pending: true };
  saveCache();
  hideModal(editModal);
  render();

  try {
    const action = e._pendingCreate ? 'add-entry' : 'update-entry';
    const data = await api(action, { entry: stripLocalFlags(next) });
    const saved = data.entry;
    const i2 = state.entries.findIndex(x => x.id === saved.id);
    if (i2 >= 0) state.entries[i2] = { ...saved, pending: false };
    saveCache();
    render();
    flashSync('Updated', 'ok');
  } catch (err) {
    flashSync('Could not sync edit: ' + err.message, 'error');
  } finally {
    editingId = null;
  }
}

async function confirmDelete() {
  if (!editingId) return;
  if (!confirm('Delete this entry?')) return;
  const id = editingId;
  const target = state.entries.find(e => e.id === id);
  state.entries = state.entries.filter(e => e.id !== id);
  saveCache();
  hideModal(editModal);
  editingId = null;
  render();
  // Skip the server delete if the entry was never persisted there.
  if (target && target._pendingCreate) {
    flashSync('Deleted', 'ok');
    return;
  }
  try {
    await api('delete-entry', { id });
    flashSync('Deleted', 'ok');
  } catch (err) {
    flashSync('Could not sync delete: ' + err.message, 'error');
  }
}

// ----- Modals helpers -----

function openComfortModal(label) {
  $('comfortSub').textContent = `${label} — looks short. Was this a real feeding?`;
  showModal(comfortModal);
}

// Offer to start a bottle right after a breast feeding (combination-feed
// flow). Only fires for left/right entries, only when the user explicitly
// stopped the session (not from edit, conflict, or discard paths), and
// only when the setting is on. Default: on.
function maybeOfferBottleChain(type) {
  if (type !== 'left' && type !== 'right') return;
  if (state.settings.offerBottleChain === false) return;
  $('chainSub').textContent = 'Combination feeding? Start a bottle now in one tap.';
  showModal(chainBottleModal);
}

async function resolveComfort(isComfort) {
  if (!pendingComfort) return hideModal(comfortModal);
  const entry = { ...pendingComfort, isComfort };
  pendingComfort = null;
  hideModal(comfortModal);
  await completeEntry(entry);
  // The comfort flow is reached from both the breast stop path and the
  // bottle-below-min stop path; the chain prompt only applies to breast.
  maybeOfferBottleChain(entry.type);
}

function openSaveModal(session) {
  const meta = TYPE_META[session.type];
  $('modalTitle').textContent = `Save ${meta.title.toLowerCase()}`;
  const dur = formatDuration(session.end - session.start);
  $('modalSub').textContent = `${dur} · ${formatTimeRange(session.start, session.end)}`;
  $('sourceField').classList.toggle('hidden', !meta.needsSource);
  $('volumeField').classList.toggle('hidden', !meta.needsVolume);
  $('volumeInput').value = '';
  stopModal.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  showModal(stopModal);
  if (meta.needsVolume) setTimeout(() => $('volumeInput').focus(), 200);
}

function showModal(m) { m.classList.remove('hidden'); }
function hideModal(m) { m.classList.add('hidden'); }
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideError(el) { el.classList.add('hidden'); el.textContent = ''; }
function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.classList.toggle('busy', busy);
}
function flashField(el) {
  el.style.boxShadow = '0 0 0 3px rgba(217, 83, 107, 0.3)';
  setTimeout(() => { el.style.boxShadow = ''; }, 600);
}
function flashSync(msg, kind) {
  syncBanner.textContent = msg;
  syncBanner.className = 'sync-banner ' + (kind || 'ok');
  syncBanner.classList.remove('hidden');
  clearTimeout(flashSync._t);
  flashSync._t = setTimeout(() => syncBanner.classList.add('hidden'), 2400);
}

// ----- Render -----

function render() {
  // Header user chip
  if (state.user) {
    userChip.classList.remove('hidden');
    $('userChipName').textContent = state.user;
    $('userChipAvatar').textContent = state.user.charAt(0).toUpperCase();
  } else {
    userChip.classList.add('hidden');
  }

  // Tile state. Other tiles are NOT disabled while a session is running —
  // tapping them opens the conflict modal so the user can choose how to
  // hand off (continue / stop & start / discard & start).
  grid.querySelectorAll('.tile').forEach(t => {
    t.classList.remove('is-active', 'disabled');
    const tm = t.querySelector('.live-timer');
    if (tm) tm.textContent = '00:00';
  });
  const activeEntry = getActiveEntry();
  if (activeEntry) {
    const tile = grid.querySelector(`.tile[data-action="${activeEntry.type}"]`);
    if (tile) tile.classList.add('is-active');
    if (!tickHandle) startTick();
    tickNow();
  } else if (tickHandle) {
    stopTick();
  }

  renderEntries();
  tickMetrics();
}

function renderEntries() {
  const dayStart = selectedDayStart();
  const dayEnd = dayStart + 86400000;

  // Update day label, "Today" link, and prev/next disabled state
  $('dayLabel').textContent = formatDayLabel(dayStart);
  const isToday = !state.historyDate;
  $('backToToday').classList.toggle('hidden', isToday);
  $('dayNext').disabled = isToday;

  entriesEl.innerHTML = '';
  const dayEntries = state.entries.filter(e => {
    const ts = e.start || e.end || 0;
    return ts >= dayStart && ts < dayEnd;
  });

  if (!dayEntries.length) {
    emptyState.classList.remove('hidden');
    emptyState.textContent = isToday
      ? 'No feedings logged today. Tap a tile above to start.'
      : 'No entries on this day. Pick another from the calendar.';
    return;
  }
  emptyState.classList.add('hidden');

  // Pumps never participate in chains (not feeding for the baby).
  // Build chains over the day's feed entries only, then merge pumps
  // back in as standalone groups, and sort everything newest-first.
  const pumps = dayEntries.filter(e => e.type === 'pump');
  const feeds = feedEntriesOnly(dayEntries);
  const maxGapMin = Number(state.settings.mergeMaxGapMin) || 0;
  const feedChains = buildChains(feeds, maxGapMin);

  const groups = [
    ...feedChains.map(c => ({ entries: c, sortKey: c[c.length - 1].start || 0 })),
    ...pumps.map(p => ({ entries: [p], sortKey: p.start || 0 })),
  ];
  groups.sort((a, b) => b.sortKey - a.sortKey);

  for (const g of groups) {
    if (g.entries.length === 1) {
      entriesEl.appendChild(renderEntry(g.entries[0]));
    } else {
      entriesEl.appendChild(renderChain(g.entries));
    }
  }
}

// Render a chain of 2+ feed entries as a single grouped card. Inner rows
// are real .entry elements so the existing tap-to-edit handler keeps
// working — no ambiguity about which entry the tap targets.
function renderChain(entries) {
  const li = document.createElement('li');
  li.className = 'entry-chain';

  const first = entries[0];
  const last = entries[entries.length - 1];
  const startClock = formatClock(first.start);
  const endClock = last.end ? formatClock(last.end) : 'live';

  const head = document.createElement('div');
  head.className = 'entry-chain-head';
  head.innerHTML = `
    <span class="entry-chain-label">
      <span>Chain</span>
      <span class="entry-chain-count">${entries.length} feeds</span>
    </span>
    <span class="entry-chain-time">${escapeHtml(startClock)} → ${escapeHtml(endClock)}</span>
  `;

  const body = document.createElement('ul');
  body.className = 'entry-chain-body';
  // Newest entry on top inside the card, matching the outer list direction.
  for (let i = entries.length - 1; i >= 0; i--) {
    body.appendChild(renderEntry(entries[i]));
  }

  li.appendChild(head);
  li.appendChild(body);
  return li;
}

// ----- Day picker -----

function selectedDayStart() {
  if (state.historyDate) {
    const [y, m, d] = state.historyDate.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openDayPicker() {
  const di = $('dayInput');
  di.value = state.historyDate || todayKey();
  di.max = todayKey();
  if (typeof di.showPicker === 'function') {
    try { di.showPicker(); return; } catch {}
  }
  // Fallback: temporarily make the input interactive and focus it
  di.classList.remove('day-input-hidden');
  di.focus();
  di.click();
  setTimeout(() => di.classList.add('day-input-hidden'), 50);
}

function onDayPicked() {
  const v = $('dayInput').value;
  if (!v) {
    state.historyDate = null;
  } else {
    state.historyDate = v === todayKey() ? null : v;
  }
  render();
}

function stepDay(delta) {
  const cur = new Date(selectedDayStart());
  cur.setDate(cur.getDate() + delta);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (cur.getTime() > today.getTime()) return; // never future
  const key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
  state.historyDate = (key === todayKey()) ? null : key;
  render();
}

function renderEntry(e) {
  const meta = TYPE_META[e.type] || { short: e.type };
  const li = document.createElement('li');
  li.className = 'entry' + (e.pending ? ' pending' : '');
  li.tabIndex = 0;
  li.addEventListener('click', () => openEditModal(e.id));

  const icon = document.createElement('div');
  icon.className = `entry-icon ${e.type}`;
  icon.innerHTML = entryIconSvg(e.type);

  const main = document.createElement('div');
  main.className = 'entry-main';
  const title = document.createElement('div');
  title.className = 'entry-title';
  let titleText = meta.short;
  if (e.type === 'bottle' && e.source) titleText += ` · ${e.source === 'own' ? 'Own milk' : 'Formula'}`;
  title.textContent = titleText;

  const metaRow = document.createElement('div');
  metaRow.className = 'entry-meta';
  const isLive = e.start && e.end == null && !e.deleted;
  const dur = (e.start && e.end) ? formatDuration(e.end - e.start) : (isLive ? formatDuration(Date.now() - e.start) : '—');
  const needsVolume = (e.type === 'bottle' || e.type === 'pump') && e.volume == null && e.end != null;
  metaRow.innerHTML = `
    <span>${formatTimeRange(e.start, e.end)}</span>
    <span class="dot">•</span>
    <span>${dur}</span>
    ${e.user ? `<span class="dot">•</span><span>${escapeHtml(e.user)}</span>` : ''}
    ${isLive ? `<span class="dot">•</span><span class="live-mark">live</span>` : ''}
    ${e.pending ? `<span class="dot">•</span><span class="pending-mark">syncing…</span>` : ''}
    ${needsVolume ? `<span class="dot">•</span><span class="needs-volume-hint">add volume</span>` : ''}
    ${e.isComfort ? `<span class="dot">•</span><span class="comfort-mark">comfort</span>` : ''}
  `;
  main.append(title, metaRow);

  const right = document.createElement('div');
  right.className = 'entry-right';
  if (e.volume != null) {
    right.innerHTML = `<strong>${e.volume} ml</strong><span>${formatClock(e.start)}</span>`;
  } else {
    right.innerHTML = `<strong>${formatClock(e.start)}</strong><span>${relativeTime(e.start)}</span>`;
  }

  li.append(icon, main, right);
  return li;
}

// ----- Top metrics -----

function startMetricsTick() {
  if (metricsHandle) clearInterval(metricsHandle);
  metricsHandle = setInterval(tickMetrics, 30 * 1000);
}

// Sliding 24h window for the totals area. Offset 0 = the 24h ending now,
// offset 1 = the 24h before that, etc. Half-open interval [start, end) so
// neighbouring windows never double-count an entry that lands on a boundary.
function statsWindow() {
  const now = Date.now();
  const offset = Math.max(0, state.statsOffset | 0);
  const DAY = 86400000;
  return { start: now - (offset + 1) * DAY, end: now - offset * DAY, now, offset };
}

function formatStatsWindowLabel(offset) {
  if (offset <= 0) return 'Last 24h';
  if (offset === 1) return '24–48h ago';
  return `${offset * 24}–${(offset + 1) * 24}h ago`;
}

function stepStatsWindow(delta) {
  const next = Math.max(0, (state.statsOffset | 0) + delta);
  if (next === state.statsOffset) return;
  state.statsOffset = next;
  tickMetrics();
}

function tickMetrics() {
  const win = statsWindow();
  const now = win.now;
  const maxGapMin = Number(state.settings.mergeMaxGapMin) || 0;

  // Update stepper UI: `‹` is disabled when there's no entry strictly older
  // than the current window's start (no point walking into emptiness).
  const hasOlder = state.entries.some(e => (e.start || 0) < win.start);
  $('statsPrev').disabled = !hasOlder;
  $('statsNext').disabled = win.offset === 0;
  $('statsNow').classList.toggle('hidden', win.offset === 0);
  $('statsWindowLabel').textContent = formatStatsWindowLabel(win.offset);
  $('statPumpWindowLabel').textContent = win.offset === 0 ? '24h' : formatStatsWindowLabel(win.offset);

  // ----- Row 1: feeding status -----
  // Both "Last" and "Next" share the same anchor — the chain's earliest
  // non-comfort start when grouping is on, otherwise the latest completed
  // non-comfort feed's start. That way the two displayed numbers always
  // satisfy `(time since last) + (time until next) = interval`, instead
  // of leaking the chain span (or the last feed's duration).
  const feeds = state.entries.filter(e => TYPE_META[e.type]?.isFeed && e.end && !e.isComfort);
  feeds.sort((a, b) => (b.end || 0) - (a.end || 0));
  const lastFeed = feeds[0];

  if (lastFeed) {
    const anchorStart = chainAnchorStart(lastFeed, maxGapMin);
    $('statLast').textContent = relativeTime(anchorStart);
    const intervalMin = Number(state.settings.feedingIntervalMin) || 180;
    const dueAt = anchorStart + intervalMin * 60 * 1000;
    const diff = dueAt - now;
    const clock = formatClock(dueAt);
    const nextEl = $('statNext');
    if (diff > 0) {
      nextEl.textContent = `in ${formatRel(diff)} · ${clock}`;
      nextEl.classList.remove('overdue');
    } else {
      nextEl.textContent = `overdue ${formatRel(-diff)} · ${clock}`;
      nextEl.classList.add('overdue');
    }
  } else {
    $('statLast').textContent = '—';
    $('statNext').textContent = '—';
    $('statNext').classList.remove('overdue');
  }

  // Breast alternation indicator
  grid.querySelectorAll('.tile[data-action="left"], .tile[data-action="right"]').forEach(t => t.classList.remove('is-next'));
  if (!getActiveEntry()) {
    const lastBreast = state.entries
      .filter(e => (e.type === 'left' || e.type === 'right') && e.end && !e.isComfort)
      .sort((a, b) => (b.start || 0) - (a.start || 0))[0];
    if (lastBreast) {
      const nextType = lastBreast.type === 'left' ? 'right' : 'left';
      grid.querySelector(`.tile[data-action="${nextType}"]`)?.classList.add('is-next');
    }
  }

  // ----- Row 2: feeding totals over the selected sliding window -----
  // "Feeds" counts CHAINS (a chain = one feeding session per spec #5),
  // but ml/min totals still sum every individual entry — the grouping
  // is about how we count meals, not how we count milk.
  // Window membership uses the entry's `start`, matching how chains are
  // bucketed elsewhere; cross-window entries naturally contribute to
  // whichever window they began in.
  const inWindow = e => {
    const s = e.start || 0;
    return s >= win.start && s < win.end;
  };
  const windowFeeds = feedEntriesOnly(state.entries.filter(inWindow));
  const windowChains = buildChains(windowFeeds, maxGapMin);
  let feedCount = 0, breastCount = 0, bottleCount = 0;
  for (const chain of windowChains) {
    const realInChain = chain.filter(e => !e.isComfort);
    if (!realInChain.length) continue; // all-comfort chains don't count
    feedCount++;
    // Bucket the chain by its earliest non-comfort entry's type.
    const earliest = realInChain[0]; // chain is start-asc, real subset preserves order
    if (earliest.type === 'bottle') bottleCount++;
    else breastCount++;
  }
  let bottleMl = 0, ownMl = 0, formulaMl = 0;
  let breastMs = 0;
  for (const e of state.entries) {
    if (!inWindow(e)) continue;
    if (!TYPE_META[e.type]?.isFeed || e.isComfort) continue;
    if (e.type === 'bottle') {
      if (e.volume) bottleMl += e.volume;
      if (e.volume && e.source === 'own') ownMl += e.volume;
      else if (e.volume && e.source === 'formula') formulaMl += e.volume;
    } else if (e.type === 'left' || e.type === 'right') {
      if (e.start && e.end) breastMs += (e.end - e.start);
    }
  }
  // Include the currently running breast session for the live window only.
  // For older windows the running entry hasn't ended yet so it would skew
  // the historical total — past windows stay frozen.
  const runningEntry = getActiveEntry();
  if (
    runningEntry &&
    (runningEntry.type === 'left' || runningEntry.type === 'right') &&
    win.offset === 0 &&
    runningEntry.start >= win.start &&
    runningEntry.start < win.end
  ) {
    breastMs += now - runningEntry.start;
  }

  $('statTodayFeed').textContent = `${feedCount}×`;
  const feedSubParts = [];
  if (breastCount) feedSubParts.push(`${breastCount} breast`);
  if (bottleCount) feedSubParts.push(`${bottleCount} bottle`);
  $('statTodayFeedSub').textContent = feedSubParts.join(' · ');

  $('statTodayBottle').textContent = `${bottleMl} ml`;
  const bottleSubParts = [];
  if (ownMl) bottleSubParts.push(`${ownMl} own`);
  if (formulaMl) bottleSubParts.push(`${formulaMl} formula`);
  $('statTodayBottleSub').textContent = bottleSubParts.join(' · ');

  const breastMin = Math.round(breastMs / 60000);
  $('statTodayBreast').textContent = `${breastMin} min`;

  // ----- Pumping block -----
  const pumps = state.entries.filter(e => e.type === 'pump' && e.end);
  pumps.sort((a, b) => (b.end || 0) - (a.end || 0));
  const lastPump = pumps[0];
  $('statLastPump').textContent = lastPump ? relativeTime(lastPump.end) : '—';

  let pumpMl = 0;
  for (const e of state.entries) {
    if (e.type !== 'pump') continue;
    if (inWindow(e) && e.volume) pumpMl += e.volume;
  }
  $('statTodayPump').textContent = `${pumpMl} ml`;
}

function formatRel(ms) {
  if (ms < 0) ms = -ms;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// ----- Utils -----

function cryptoId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function pad(n) { return n.toString().padStart(2, '0'); }

function formatClock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatTimeRange(a, b) { return `${formatClock(a)} – ${formatClock(b)}`; }

function dayKey(ts) {
  if (!ts) return '0';
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function formatDayLabel(ts) {
  const d = new Date(ts || Date.now());
  const today = new Date(); today.setHours(0,0,0,0);
  const yest = new Date(today.getTime() - 86400000);
  const startOf = new Date(d); startOf.setHours(0,0,0,0);
  if (startOf.getTime() === today.getTime()) return 'Today';
  if (startOf.getTime() === yest.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function relativeTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function toLocalDatetime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const off = d.getTimezoneOffset();
  const local = new Date(ts - off * 60000);
  return local.toISOString().slice(0, 16);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function entryIconSvg(type) {
  if (type === 'left' || type === 'right') {
    const cx = type === 'left' ? 9 : 15;
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="${cx}" cy="12" r="7"/><circle cx="${cx}" cy="12" r="1.6" fill="currentColor"/></svg>`;
  }
  if (type === 'bottle') {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="3" rx="1.4" ry="1.1"/><path d="M10 5h4"/><rect x="8.5" y="6" width="7" height="2" rx="0.5"/><path d="M9 9h6v9.5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><line x1="11" y1="13" x2="13" y2="13" opacity="0.5"/><line x1="11" y1="16" x2="13" y2="16" opacity="0.5"/></svg>`;
  }
  // pump — tabletop machine style (body + handle + display + knob + tubes)
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9.5" width="18" height="10" rx="2.5"/><path d="M7.5 9.5 V7.5 Q7.5 5.5 12 5.5 Q16.5 5.5 16.5 7.5 V9.5"/><rect x="4.5" y="11.5" width="7" height="3" rx="0.8"/><circle cx="16" cy="13.5" r="2"/><path d="M3 12 L1 11 M3 14.5 L1 15.5"/></svg>`;
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    user: state.user,
    entries: state.entries,
    settings: state.settings,
    users: state.users,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedmeter-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
