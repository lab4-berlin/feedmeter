// ----- Storage -----
const STORE = {
  entries: 'feedmeter.entries.v1',
  active: 'feedmeter.active.v1',
};

const TYPE_META = {
  left:   { title: 'Left breast',   short: 'Left',   needsVolume: false, needsSource: false },
  right:  { title: 'Right breast',  short: 'Right',  needsVolume: false, needsSource: false },
  bottle: { title: 'Bottle',        short: 'Bottle', needsVolume: true,  needsSource: true  },
  pump:   { title: 'Pump',          short: 'Pump',   needsVolume: true,  needsSource: false },
};

// ----- DOM -----
const $ = (id) => document.getElementById(id);
const grid = $('actionGrid');
const entriesEl = $('entries');
const emptyState = $('emptyState');
const stopModal = $('stopModal');
const editModal = $('editModal');

// ----- State -----
let active = loadActive();
let entries = loadEntries();
let pendingSave = null;
let editingId = null;
let tickHandle = null;

// ----- Init -----
render();
if (active) startTick();

// ----- Event wiring -----
grid.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || tile.classList.contains('disabled')) return;
  if (tile.classList.contains('is-active')) {
    stopSession();
  } else {
    startSession(tile.dataset.action);
  }
});

$('cancelSave').addEventListener('click', () => {
  pendingSave = null;
  hideModal(stopModal);
});

$('saveBtn').addEventListener('click', () => {
  if (!pendingSave) return hideModal(stopModal);
  const meta = TYPE_META[pendingSave.type];
  const volume = parseInt($('volumeInput').value, 10);
  const source = stopModal.querySelector('.seg-btn.active')?.dataset.source || null;

  if (meta.needsVolume && (isNaN(volume) || volume < 0)) {
    flashField($('volumeInput'));
    return;
  }
  if (meta.needsSource && !source) {
    flashField(stopModal.querySelector('.seg'));
    return;
  }

  entries.push({
    id: cryptoId(),
    type: pendingSave.type,
    start: pendingSave.start,
    end: pendingSave.end,
    volume: meta.needsVolume ? volume : null,
    source: meta.needsSource ? source : null,
    note: null,
  });
  saveEntries();
  pendingSave = null;
  hideModal(stopModal);
  render();
});

stopModal.querySelectorAll('[data-source]').forEach(b => {
  b.addEventListener('click', () => {
    stopModal.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
});

editModal.querySelectorAll('[data-edit-source]').forEach(b => {
  b.addEventListener('click', () => {
    editModal.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
});

$('cancelEdit').addEventListener('click', () => {
  editingId = null;
  hideModal(editModal);
});
$('saveEdit').addEventListener('click', () => {
  if (!editingId) return;
  const idx = entries.findIndex(e => e.id === editingId);
  if (idx < 0) return;
  const e = entries[idx];
  const meta = TYPE_META[e.type];
  const startMs = new Date($('editStart').value).getTime();
  const endMs = new Date($('editEnd').value).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
    flashField($('editEnd'));
    return;
  }
  e.start = startMs;
  e.end = endMs;
  if (meta.needsVolume) {
    const v = parseInt($('editVolume').value, 10);
    e.volume = isNaN(v) ? null : v;
  }
  if (meta.needsSource) {
    e.source = editModal.querySelector('.seg-btn.active')?.dataset.editSource || e.source;
  }
  saveEntries();
  editingId = null;
  hideModal(editModal);
  render();
});
$('deleteEntry').addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('Delete this entry?')) return;
  entries = entries.filter(e => e.id !== editingId);
  saveEntries();
  editingId = null;
  hideModal(editModal);
  render();
});

$('clearAllBtn').addEventListener('click', () => {
  if (!entries.length) return;
  if (!confirm('Delete ALL entries? This cannot be undone.')) return;
  entries = [];
  saveEntries();
  render();
});

$('exportBtn').addEventListener('click', exportData);

// Close modal by tapping backdrop
[stopModal, editModal].forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m) {
      if (m === stopModal) pendingSave = null;
      if (m === editModal) editingId = null;
      hideModal(m);
    }
  });
});

// Keep timer correct when tab returns from background
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && active) tickNow();
});

// ----- Session control -----
function startSession(type) {
  if (active) return;
  active = { type, start: Date.now() };
  saveActive();
  startTick();
  render();
}

function stopSession() {
  if (!active) return;
  const session = { ...active, end: Date.now() };
  active = null;
  saveActive();
  stopTick();

  const meta = TYPE_META[session.type];
  // Breast sessions need no extra info — save immediately, no popup.
  if (!meta.needsVolume && !meta.needsSource) {
    entries.push({
      id: cryptoId(),
      type: session.type,
      start: session.start,
      end: session.end,
      volume: null,
      source: null,
      note: null,
    });
    saveEntries();
    render();
    return;
  }

  render();
  pendingSave = session;
  openSaveModal(session);
}

function startTick() {
  stopTick();
  tickNow();
  tickHandle = setInterval(tickNow, 1000);
}
function stopTick() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}
function tickNow() {
  if (!active) return;
  const elapsed = Date.now() - active.start;
  const text = formatDuration(elapsed);
  const tile = grid.querySelector(`.tile[data-action="${active.type}"]`);
  if (tile) {
    const t = tile.querySelector('.live-timer');
    if (t) t.textContent = text;
  }
}

// ----- Modals -----
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

function openEditModal(id) {
  const e = entries.find(x => x.id === id);
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

function showModal(m) { m.classList.remove('hidden'); }
function hideModal(m) { m.classList.add('hidden'); }

function flashField(el) {
  el.style.transition = 'box-shadow 0.2s';
  el.style.boxShadow = '0 0 0 3px rgba(217, 83, 107, 0.3)';
  setTimeout(() => { el.style.boxShadow = ''; }, 600);
}

// ----- Render -----
function render() {
  grid.querySelectorAll('.tile').forEach(t => {
    t.classList.remove('is-active', 'disabled');
    const timer = t.querySelector('.live-timer');
    if (timer) timer.textContent = '00:00';
  });

  if (active) {
    grid.querySelectorAll('.tile').forEach(t => {
      if (t.dataset.action === active.type) {
        t.classList.add('is-active');
      } else {
        t.classList.add('disabled');
      }
    });
    tickNow();
  }

  renderEntries();
  renderStats();
}

function renderEntries() {
  entriesEl.innerHTML = '';
  if (!entries.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const sorted = [...entries].sort((a, b) => b.start - a.start);
  let lastDay = null;
  for (const e of sorted) {
    const day = dayKey(e.start);
    if (day !== lastDay) {
      const li = document.createElement('li');
      li.className = 'day-divider';
      li.textContent = formatDayLabel(e.start);
      entriesEl.appendChild(li);
      lastDay = day;
    }
    entriesEl.appendChild(renderEntry(e));
  }
}

function renderEntry(e) {
  const meta = TYPE_META[e.type];
  const li = document.createElement('li');
  li.className = 'entry';
  li.tabIndex = 0;
  li.addEventListener('click', () => openEditModal(e.id));

  const icon = document.createElement('div');
  icon.className = `entry-icon ${e.type}`;
  icon.innerHTML = iconSvg(e.type);

  const main = document.createElement('div');
  main.className = 'entry-main';
  const title = document.createElement('div');
  title.className = 'entry-title';
  let titleText = meta.short;
  if (e.type === 'bottle' && e.source) {
    titleText += ` · ${e.source === 'own' ? 'Own milk' : 'Formula'}`;
  }
  title.textContent = titleText;

  const metaRow = document.createElement('div');
  metaRow.className = 'entry-meta';
  metaRow.innerHTML = `
    <span>${formatTimeRange(e.start, e.end)}</span>
    <span class="dot">•</span>
    <span>${formatDuration(e.end - e.start)}</span>
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

function renderStats() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStart = today.getTime();
  let breastMs = 0;
  let intakeMl = 0;
  let last = null;
  for (const e of entries) {
    if (!last || e.start > last.start) last = e;
    if (e.start >= todayStart) {
      if (e.type === 'left' || e.type === 'right') breastMs += (e.end - e.start);
      if (e.type === 'bottle' && e.volume) intakeMl += e.volume;
    }
  }
  $('statLast').textContent = last ? `${TYPE_META[last.type].short} · ${relativeTime(last.start)}` : '—';
  $('statBreast').textContent = `${Math.round(breastMs / 60000)} min`;
  $('statIntake').textContent = `${intakeMl} ml`;
}

// ----- Utils -----
function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORE.entries)) || []; }
  catch { return []; }
}
function saveEntries() {
  localStorage.setItem(STORE.entries, JSON.stringify(entries));
}
function loadActive() {
  try { return JSON.parse(localStorage.getItem(STORE.active)); }
  catch { return null; }
}
function saveActive() {
  if (active) localStorage.setItem(STORE.active, JSON.stringify(active));
  else localStorage.removeItem(STORE.active);
}

function cryptoId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function pad(n) { return n.toString().padStart(2, '0'); }

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatTimeRange(a, b) {
  return `${formatClock(a)} – ${formatClock(b)}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function formatDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const yest = new Date(today.getTime() - 86400000);
  const startOf = new Date(d); startOf.setHours(0,0,0,0);
  if (startOf.getTime() === today.getTime()) return 'Today';
  if (startOf.getTime() === yest.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function toLocalDatetime(ts) {
  const d = new Date(ts);
  const off = d.getTimezoneOffset();
  const local = new Date(ts - off * 60000);
  return local.toISOString().slice(0, 16);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function iconSvg(type) {
  const stroke = 'currentColor';
  if (type === 'left' || type === 'right') {
    const cx = type === 'left' ? 9 : 15;
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="${cx}" cy="12" r="7"/><circle cx="${cx}" cy="12" r="1.6" fill="${stroke}"/></svg>`;
  }
  if (type === 'bottle') {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v2M14 3v2M8 7h8l-1 14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="10" height="11" rx="2"/><path d="M14 10h4a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-4"/><line x1="7" y1="7" x2="7" y2="5"/><line x1="11" y1="7" x2="11" y2="5"/></svg>`;
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    entries,
    active,
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
