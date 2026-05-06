// ----- Storage keys (per-device) -----
const LS = {
  apiUrl: 'feedmeter.apiUrl',
  passcode: 'feedmeter.passcode',
  user: 'feedmeter.user',
  cache: 'feedmeter.cache.v2',     // entries + settings + users
  active: 'feedmeter.active.v2',   // current running session
};

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
const voiceConflictModal = $('voiceConflictModal');
const comfortModal = $('comfortModal');
const weightModal = $('weightModal');
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
};
let activeTab = 'feedings';
let editingWeightId = null;
let active = loadActive();
let pendingSave = null;
let editingId = null;
let pendingComfort = null;  // entry held for comfort-feeding prompt
let pendingOpenEntry = null; // voice-started open entry awaiting conflict resolution
let tickHandle = null;
let metricsHandle = null;

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
    return;
  }
  if (!state.user) {
    openSetup({ step: 'name' });
  }
  if (active) startTick();
  startMetricsTick();
  startVoicePoll();
}

// ----- Event wiring -----
function bindEvents() {
  // Tile click: start or stop
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || tile.classList.contains('disabled')) return;
    if (tile.classList.contains('is-active')) {
      stopSession();
    } else {
      if (!ensureReady()) return;
      startSession(tile.dataset.action);
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

  // Voice conflict modal
  $('vcDiscard').addEventListener('click', vcDiscard);
  $('vcSwitch').addEventListener('click', vcSwitch);
  voiceConflictModal.addEventListener('click', (e) => {
    if (e.target === voiceConflictModal) vcDiscard();
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
      if (active) tickNow();
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
  state.entries = data.entries || [];
  state.users = data.users || [];
  state.weights = data.weights || [];
  state.settings = Object.assign({ feedingIntervalMin: 180 }, data.settings || {});
  saveCache();
  if (data.openEntry) handleOpenEntry(data.openEntry);
  render();
  if (activeTab === 'weight') renderWeightTab();
  return data;
}

function saveCache() {
  localStorage.setItem(LS.cache, JSON.stringify({
    entries: state.entries,
    users: state.users,
    weights: state.weights,
    settings: state.settings,
  }));
}

// ----- Voice session handling -----

function handleOpenEntry(oe) {
  if (!oe || !oe.id || !oe.type || !oe.start) return;

  // Already handling this exact voice session — nothing to do
  if (active && active.voiceId === oe.id) return;

  if (!active) {
    // No local session running — silently resume the voice-started one
    active = { type: oe.type, start: oe.start, voiceId: oe.id };
    saveActive();
    startTick();
  } else {
    // Conflict: a local session is already running
    pendingOpenEntry = oe;
    const meta = TYPE_META[oe.type];
    const activeMeta = TYPE_META[active.type];
    $('vcSub').textContent =
      `"${meta?.title || oe.type}" started via Google Home at ${formatClock(oe.start)}. ` +
      `You have an active "${activeMeta?.title || active.type}" session running.`;
    showModal(voiceConflictModal);
  }
}

async function vcDiscard() {
  if (!pendingOpenEntry) return hideModal(voiceConflictModal);
  const id = pendingOpenEntry.id;
  pendingOpenEntry = null;
  hideModal(voiceConflictModal);
  try {
    await api('discard-open', { id });
  } catch (err) {
    flashSync('Could not discard voice session: ' + err.message, 'error');
  }
}

async function vcSwitch() {
  if (!pendingOpenEntry) return hideModal(voiceConflictModal);
  const oe = pendingOpenEntry;
  pendingOpenEntry = null;
  hideModal(voiceConflictModal);

  // Close the current local session (save without prompting for volume)
  if (active) {
    const oldSession = { ...active, end: Date.now() };
    active = null;
    saveActive();
    stopTick();
    persistEntry({
      type: oldSession.type,
      start: oldSession.start,
      end: oldSession.end,
      volume: null,
      source: null,
      voiceId: oldSession.voiceId || null,
    });
  }

  // Resume the voice-started session
  active = { type: oe.type, start: oe.start, voiceId: oe.id };
  saveActive();
  startTick();
  render();
}

// Poll for voice-started sessions every 60 s while the app is visible
function startVoicePoll() {
  setInterval(() => {
    if (!state.apiUrl || !state.passcode || document.hidden) return;
    bootstrap().catch(() => {});
  }, 60000);
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
  $('settingBirthWeight').value = state.settings.birthWeightG || '';
  showModal(settingsModal);
}

async function saveSettings() {
  hideError($('settingsError'));
  const feed = parseInt($('settingFeed').value, 10);
  if (isNaN(feed) || feed < 30) return showError($('settingsError'), 'Feeding interval must be ≥ 30');
  const minDur = $('settingMinDuration').value === '' ? null : parseInt($('settingMinDuration').value, 10);
  const minVol = $('settingMinVolume').value === '' ? null : parseInt($('settingMinVolume').value, 10);
  try {
    setBusy($('settingsSave'), true);
    const birthW = $('settingBirthWeight').value === '' ? null : parseInt($('settingBirthWeight').value, 10);
    const patch = { feedingIntervalMin: feed };
    if (minDur !== null) patch.minFeedDurationMin = minDur;
    if (minVol !== null) patch.minBottleVolumeMl = minVol;
    if (birthW !== null && !isNaN(birthW)) patch.birthWeightG = birthW;
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

function startSession(type) {
  if (active) return;
  active = { type, start: Date.now() };
  saveActive();
  startTick();
  render();
}

async function stopSession() {
  if (!active) return;
  const session = { ...active, end: Date.now() };
  active = null;
  saveActive();
  stopTick();
  render();

  const meta = TYPE_META[session.type];
  if (!meta.needsVolume && !meta.needsSource) {
    // Breast: check duration threshold before persisting
    const durationSec = (session.end - session.start) / 1000;
    const minDurationSec = (Number(state.settings.minFeedDurationMin) || 0) * 60;
    if (meta.isFeed && minDurationSec > 0 && durationSec < minDurationSec) {
      pendingComfort = { type: session.type, start: session.start, end: session.end, volume: null, source: null, voiceId: session.voiceId || null };
      openComfortModal(`${meta.title} · ${formatDuration(session.end - session.start)}`);
      return;
    }
    await persistEntry({
      type: session.type,
      start: session.start,
      end: session.end,
      volume: null,
      source: null,
      isComfort: false,
      voiceId: session.voiceId || null,
    });
    return;
  }
  pendingSave = session; // session carries voiceId if voice-started
  openSaveModal(session);
}

async function confirmSave() {
  if (!pendingSave) return hideModal(stopModal);
  const meta = TYPE_META[pendingSave.type];
  const volume = parseInt($('volumeInput').value, 10);
  const source = stopModal.querySelector('.seg-btn.active')?.dataset.source || null;
  if (meta.needsVolume && (isNaN(volume) || volume < 0)) return flashField($('volumeInput'));
  if (meta.needsSource && !source) return flashField(stopModal.querySelector('.seg'));

  const entry = {
    type: pendingSave.type,
    start: pendingSave.start,
    end: pendingSave.end,
    volume: meta.needsVolume ? volume : null,
    source: meta.needsSource ? source : null,
    voiceId: pendingSave.voiceId || null,
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
  await persistEntry({ ...entry, isComfort: false });
}

async function persistEntry(entry) {
  const voiceId = entry.voiceId || null;
  // Voice sessions already have a row in the sheet; use their id directly.
  // Manual sessions get a temp id until the server assigns a real one.
  const tempId = voiceId || ('tmp-' + cryptoId());
  const now = new Date().toISOString();
  const optimistic = {
    id: tempId,
    type: entry.type,
    start: entry.start,
    end: entry.end,
    volume: entry.volume,
    source: entry.source,
    isComfort: !!entry.isComfort,
    user: state.user,
    createdAt: now,
    updatedAt: now,
    pending: true,
  };
  const existingIdx = state.entries.findIndex(e => e.id === tempId);
  if (existingIdx >= 0) state.entries[existingIdx] = optimistic;
  else state.entries.push(optimistic);
  saveCache();
  render();

  try {
    let data;
    if (voiceId) {
      // Close the existing open entry in the sheet
      data = await api('update-entry', {
        entry: {
          id: voiceId,
          type: entry.type,
          start: entry.start,
          end: entry.end,
          volume: entry.volume,
          source: entry.source,
          isComfort: !!entry.isComfort,
        },
      });
    } else {
      data = await api('add-entry', { entry });
    }
    const saved = data.entry;
    const idx = state.entries.findIndex(e => e.id === tempId);
    if (idx >= 0) state.entries[idx] = saved;
    saveCache();
    render();
    flashSync('Saved', 'ok');
  } catch (err) {
    flashSync('Could not sync: ' + err.message + ' (kept locally)', 'error');
  }
}

function startTick() { stopTick(); tickNow(); tickHandle = setInterval(tickNow, 1000); }
function stopTick() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }
function tickNow() {
  if (!active) return;
  const elapsed = Date.now() - active.start;
  const text = formatDuration(elapsed);
  const tile = grid.querySelector(`.tile[data-action="${active.type}"]`);
  if (tile) tile.querySelector('.live-timer').textContent = text;
}

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
  const endMs = new Date($('editEnd').value).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return flashField($('editEnd'));

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
    const data = await api('update-entry', { entry: next });
    const saved = data.entry;
    const i2 = state.entries.findIndex(x => x.id === saved.id);
    if (i2 >= 0) state.entries[i2] = saved;
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
  state.entries = state.entries.filter(e => e.id !== id);
  saveCache();
  hideModal(editModal);
  editingId = null;
  render();
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

async function resolveComfort(isComfort) {
  if (!pendingComfort) return hideModal(comfortModal);
  const entry = { ...pendingComfort, isComfort };
  pendingComfort = null;
  hideModal(comfortModal);
  await persistEntry(entry);
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

  // Tile state
  grid.querySelectorAll('.tile').forEach(t => {
    t.classList.remove('is-active', 'disabled');
    const tm = t.querySelector('.live-timer');
    if (tm) tm.textContent = '00:00';
  });
  if (active) {
    grid.querySelectorAll('.tile').forEach(t => {
      if (t.dataset.action === active.type) t.classList.add('is-active');
      else t.classList.add('disabled');
    });
    tickNow();
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
  const dayEntries = state.entries
    .filter(e => {
      const ts = e.start || e.end || 0;
      return ts >= dayStart && ts < dayEnd;
    })
    .sort((a, b) => (b.start || 0) - (a.start || 0));

  if (!dayEntries.length) {
    emptyState.classList.remove('hidden');
    emptyState.textContent = isToday
      ? 'No feedings logged today. Tap a tile above to start.'
      : 'No entries on this day. Pick another from the calendar.';
    return;
  }
  emptyState.classList.add('hidden');

  for (const e of dayEntries) {
    entriesEl.appendChild(renderEntry(e));
  }
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
  const dur = (e.start && e.end) ? formatDuration(e.end - e.start) : '—';
  const needsVolume = (e.type === 'bottle' || e.type === 'pump') && e.volume == null && e.end != null;
  metaRow.innerHTML = `
    <span>${formatTimeRange(e.start, e.end)}</span>
    <span class="dot">•</span>
    <span>${dur}</span>
    ${e.user ? `<span class="dot">•</span><span>${escapeHtml(e.user)}</span>` : ''}
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

function tickMetrics() {
  const now = Date.now();
  const todayStart = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();

  // ----- Feeding (breast or bottle) — exclude comfort feedings -----
  const feeds = state.entries.filter(e => TYPE_META[e.type]?.isFeed && e.end && !e.isComfort);
  feeds.sort((a, b) => (b.end || 0) - (a.end || 0));
  const lastFeed = feeds[0];

  if (lastFeed) {
    $('statLast').textContent = relativeTime(lastFeed.end);
    const intervalMin = Number(state.settings.feedingIntervalMin) || 180;
    const dueAt = (lastFeed.start || 0) + intervalMin * 60 * 1000;
    const diff = dueAt - now;
    const nextEl = $('statNext');
    if (diff > 0) {
      nextEl.textContent = 'in ' + formatRel(diff);
      nextEl.classList.remove('overdue');
    } else {
      nextEl.textContent = 'overdue ' + formatRel(-diff);
      nextEl.classList.add('overdue');
    }
  } else {
    $('statLast').textContent = '—';
    $('statNext').textContent = '—';
    $('statNext').classList.remove('overdue');
  }

  // Breast alternation indicator
  grid.querySelectorAll('.tile[data-action="left"], .tile[data-action="right"]').forEach(t => t.classList.remove('is-next'));
  if (!active) {
    const lastBreast = state.entries
      .filter(e => (e.type === 'left' || e.type === 'right') && e.end && !e.isComfort)
      .sort((a, b) => (b.start || 0) - (a.start || 0))[0];
    if (lastBreast) {
      const nextType = lastBreast.type === 'left' ? 'right' : 'left';
      grid.querySelector(`.tile[data-action="${nextType}"]`)?.classList.add('is-next');
    }
  }

  let bottleMl = 0;
  let breastMs = 0;
  let feedCount = 0;
  for (const e of state.entries) {
    if ((e.start || 0) < todayStart) continue;
    if (!TYPE_META[e.type]?.isFeed || e.isComfort) continue;
    feedCount++;
    if (e.type === 'bottle' && e.volume) bottleMl += e.volume;
    if ((e.type === 'left' || e.type === 'right') && e.start && e.end) {
      breastMs += (e.end - e.start);
    }
  }
  // Include the currently running breast session (if any) in today's total
  if (active && (active.type === 'left' || active.type === 'right') && active.start >= todayStart) {
    breastMs += now - active.start;
  }
  const breastMin = Math.round(breastMs / 60000);
  const feedParts = [`${feedCount}×`];
  if (bottleMl) feedParts.push(`${bottleMl} ml`);
  if (breastMin) feedParts.push(`${breastMin} min`);
  $('statTodayFeed').textContent = feedParts.join(' · ');

  // ----- Pumping -----
  const pumps = state.entries.filter(e => e.type === 'pump' && e.end);
  pumps.sort((a, b) => (b.end || 0) - (a.end || 0));
  const lastPump = pumps[0];
  $('statLastPump').textContent = lastPump ? relativeTime(lastPump.end) : '—';

  let pumpCount = 0, pumpMl = 0;
  for (const e of state.entries) {
    if (e.type !== 'pump') continue;
    if ((e.start || 0) >= todayStart) {
      pumpCount++;
      if (e.volume) pumpMl += e.volume;
    }
  }
  $('statTodayPump').textContent = `${pumpCount}× · ${pumpMl} ml`;
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

function loadActive() {
  try { return JSON.parse(localStorage.getItem(LS.active)); }
  catch { return null; }
}
function saveActive() {
  if (active) localStorage.setItem(LS.active, JSON.stringify(active));
  else localStorage.removeItem(LS.active);
}

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
