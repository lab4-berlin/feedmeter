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
const syncBanner = $('syncBanner');
const userChip = $('userChip');

// ----- State -----
let state = {
  apiUrl: localStorage.getItem(LS.apiUrl) || '',
  passcode: localStorage.getItem(LS.passcode) || '',
  user: localStorage.getItem(LS.user) || '',
  entries: [],
  users: [],
  settings: { feedingIntervalMin: 180 },
  historyDate: null, // YYYY-MM-DD or null = today (live)
};
let active = loadActive();
let pendingSave = null;
let editingId = null;
let tickHandle = null;
let metricsHandle = null;

// Try to hydrate from local cache (snappy first paint, even offline)
try {
  const cached = JSON.parse(localStorage.getItem(LS.cache) || 'null');
  if (cached) {
    if (Array.isArray(cached.entries)) state.entries = cached.entries;
    if (Array.isArray(cached.users)) state.users = cached.users;
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
  state.settings = Object.assign({ feedingIntervalMin: 180 }, data.settings || {});
  saveCache();
  render();
  return data;
}

function saveCache() {
  localStorage.setItem(LS.cache, JSON.stringify({
    entries: state.entries,
    users: state.users,
    settings: state.settings,
  }));
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
  showModal(settingsModal);
}

async function saveSettings() {
  hideError($('settingsError'));
  const feed = parseInt($('settingFeed').value, 10);
  if (isNaN(feed) || feed < 30) return showError($('settingsError'), 'Feeding interval must be ≥ 30');
  try {
    setBusy($('settingsSave'), true);
    const data = await api('update-settings', {
      settings: { feedingIntervalMin: feed },
    });
    state.settings = Object.assign(state.settings, data.settings || {});
    saveCache();
    hideModal(settingsModal);
    render();
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
    // Breast: persist immediately, no modal
    await persistEntry({
      type: session.type,
      start: session.start,
      end: session.end,
      volume: null,
      source: null,
    });
    return;
  }
  pendingSave = session;
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
  };
  pendingSave = null;
  hideModal(stopModal);
  await persistEntry(entry);
}

async function persistEntry(entry) {
  // Optimistic local insert with a temp id
  const tempId = 'tmp-' + cryptoId();
  const now = new Date().toISOString();
  const optimistic = {
    id: tempId,
    type: entry.type,
    start: entry.start,
    end: entry.end,
    volume: entry.volume,
    source: entry.source,
    user: state.user,
    createdAt: now,
    updatedAt: now,
    pending: true,
  };
  state.entries.push(optimistic);
  saveCache();
  render();

  try {
    const data = await api('add-entry', { entry });
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
  metaRow.innerHTML = `
    <span>${formatTimeRange(e.start, e.end)}</span>
    <span class="dot">•</span>
    <span>${dur}</span>
    ${e.user ? `<span class="dot">•</span><span>${escapeHtml(e.user)}</span>` : ''}
    ${e.pending ? `<span class="dot">•</span><span class="pending-mark">syncing…</span>` : ''}
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

  // ----- Feeding (breast or bottle) -----
  const feeds = state.entries.filter(e => TYPE_META[e.type]?.isFeed && e.end);
  feeds.sort((a, b) => (b.end || 0) - (a.end || 0));
  const lastFeed = feeds[0];

  if (lastFeed) {
    $('statLast').textContent = relativeTime(lastFeed.end);
    const intervalMin = Number(state.settings.feedingIntervalMin) || 180;
    const dueAt = (lastFeed.end || 0) + intervalMin * 60 * 1000;
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

  let bottleMl = 0;
  let breastMs = 0;
  for (const e of state.entries) {
    if ((e.start || 0) < todayStart) continue;
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
  $('statTodayFeed').textContent = `${bottleMl} ml · ${breastMin} min`;

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
  // pump — wearable cup style (matches tile)
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="8" ry="9"/><ellipse cx="12" cy="10" rx="2.4" ry="1.4"/><circle cx="12" cy="18" r="0.8" fill="currentColor" stroke="none"/></svg>`;
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
