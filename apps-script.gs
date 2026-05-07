/**
 * FeedMeter — Google Apps Script backend.
 *
 * Deploy as Web App:
 *   - Execute as: Me
 *   - Who has access: Anyone
 * The passcode (stored in the "settings" tab) is the access control.
 *
 * Sheets created automatically on first run:
 *   "entries"  — id, createdAt, updatedAt, user, type, start, end, durationSec, volumeMl, source, deleted
 *   "settings" — key | value
 *      keys:
 *        passcode               (string, default "changeme" — change it!)
 *        feedingIntervalMin     (number, default 180)
 *        user                   (repeated; one row per known user name)
 */

const ENTRIES_SHEET = 'feedings';
const SETTINGS_SHEET = 'settings';
const WEIGHT_SHEET = 'weight';
const ENTRIES_HEADERS = [
  'id','createdAt','updatedAt','user','type',
  'start','end','durationSec','volumeMl','source','deleted','isComfort'
];
const WEIGHT_HEADERS = ['id','createdAt','updatedAt','date','weightG','timing','deleted'];
const SETTINGS_HEADERS = ['key','value'];

function doGet(e) {
  return jsonOutput_({
    ok: true,
    message: 'FeedMeter API is running. Use POST with JSON body.'
  });
}

/**
 * Run this once from the Apps Script editor to create the "entries" and
 * "settings" tabs and seed defaults (passcode "changeme", default users,
 * intervals). Re-running it is safe — it only seeds when the settings
 * tab is empty.
 */
function init() {
  ensureInit_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('FeedMeter ready. Sheet: ' + ss.getName());
  Logger.log('Tabs: ' + ss.getSheets().map(s => s.getName()).join(', '));
  Logger.log('Now open the "settings" tab and change "passcode" from "changeme".');
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'Invalid JSON body' });
  }

  try {
    const action = String(body.action || '');
    if (action !== 'ping' && !checkPasscode_(body.passcode)) {
      return jsonOutput_({ ok: false, error: 'Invalid passcode' });
    }

    switch (action) {
      case 'ping':            return jsonOutput_({ ok: true });
      case 'bootstrap':       return jsonOutput_({ ok: true, ...bootstrap_() });
      case 'list-entries':    return jsonOutput_({ ok: true, entries: listEntries_() });
      case 'add-entry':       return jsonOutput_({ ok: true, entry: addEntry_(body.entry, body.user) });
      case 'update-entry':    return jsonOutput_({ ok: true, entry: updateEntry_(body.entry, body.user) });
      case 'delete-entry':    return jsonOutput_({ ok: true, id: deleteEntry_(body.id, body.user) });
      case 'add-user':        return jsonOutput_({ ok: true, users: addUser_(body.name) });
      case 'update-settings': return jsonOutput_({ ok: true, settings: updateSettings_(body.settings) });
      case 'add-weight':      return jsonOutput_({ ok: true, weight: addWeight_(body.weight) });
      case 'update-weight':   return jsonOutput_({ ok: true, weight: updateWeight_(body.weight) });
      case 'delete-weight':   return jsonOutput_({ ok: true, id: deleteWeight_(body.id) });
      default:                return jsonOutput_({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonOutput_({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---------- helpers ----------

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    if (headers) {
      s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      s.setFrozenRows(1);
    }
  }
  return s;
}

function ensureInit_() {
  getSheet_(ENTRIES_SHEET, ENTRIES_HEADERS);
  getSheet_(WEIGHT_SHEET, WEIGHT_HEADERS);
  const settings = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  if (settings.getLastRow() < 2) {
    const defaults = [
      ['passcode', 'changeme'],
      ['feedingIntervalMin', 180],
      ['user', 'Mama'],
      ['user', 'Papa'],
    ];
    settings.getRange(2, 1, defaults.length, 2).setValues(defaults);
  }
}

function checkPasscode_(p) {
  ensureInit_();
  const s = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  const data = s.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'passcode') {
      return String(data[i][1]) === String(p || '');
    }
  }
  return false;
}

function bootstrap_() {
  ensureInit_();
  return {
    users: getUsers_(),
    settings: readSettings_(),
    entries: listEntries_(),
    weights: listWeights_(),
  };
}

// ---------- entries ----------

function listEntries_() {
  const s = getSheet_(ENTRIES_SHEET, ENTRIES_HEADERS);
  const data = s.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1).map(rowToEntry_).filter(e => e && !e.deleted);
}

function rowToEntry_(r) {
  if (!r[0]) return null;
  return {
    id: String(r[0]),
    createdAt: r[1] instanceof Date ? r[1].toISOString() : (r[1] || null),
    updatedAt: r[2] instanceof Date ? r[2].toISOString() : (r[2] || null),
    user: r[3] || null,
    type: r[4] || null,
    start: r[5] instanceof Date ? r[5].getTime() : (r[5] ? new Date(r[5]).getTime() : null),
    end:   r[6] instanceof Date ? r[6].getTime() : (r[6] ? new Date(r[6]).getTime() : null),
    durationSec: r[7] === '' ? null : Number(r[7]),
    volume: r[8] === '' ? null : Number(r[8]),
    source: r[9] || null,
    deleted: r[10] === true || String(r[10]).toUpperCase() === 'TRUE',
    isComfort: r[11] === true || String(r[11] || '').toUpperCase() === 'TRUE',
  };
}

function addEntry_(entry, user) {
  if (!entry || !entry.type) throw new Error('Missing entry.type');
  const s = getSheet_(ENTRIES_SHEET, ENTRIES_HEADERS);
  // Idempotence: if a row with this client-supplied id already exists, return
  // it as-is. Lets offline retries safely re-send the same create without
  // creating duplicate rows.
  if (entry.id) {
    const existingRow = findRow_(s, entry.id);
    if (existingRow > 0) {
      const r = s.getRange(existingRow, 1, 1, ENTRIES_HEADERS.length).getValues()[0];
      return rowToEntry_(r);
    }
  }
  const now = new Date();
  const id = entry.id || Utilities.getUuid();
  const start = entry.start ? new Date(entry.start) : null;
  const end   = entry.end   ? new Date(entry.end)   : null;
  const duration = (start && end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
  // entry.user wins over the body-level user so the original starter is kept
  // when a different device finishes the entry later.
  const userField = entry.user || user || 'Unknown';
  s.appendRow([
    id, now, now, userField,
    entry.type, start, end, duration,
    entry.volume == null ? '' : Number(entry.volume),
    entry.source || '',
    false,
    !!entry.isComfort,
  ]);
  return {
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    user: userField,
    type: entry.type,
    start: start ? start.getTime() : null,
    end: end ? end.getTime() : null,
    durationSec: duration,
    volume: entry.volume == null ? null : Number(entry.volume),
    source: entry.source || null,
    deleted: false,
    isComfort: !!entry.isComfort,
  };
}

function findRow_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function updateEntry_(entry, user) {
  if (!entry || !entry.id) throw new Error('Missing entry.id');
  const s = getSheet_(ENTRIES_SHEET, ENTRIES_HEADERS);
  const row = findRow_(s, entry.id);
  if (row < 0) throw new Error('Entry not found: ' + entry.id);
  const now = new Date();
  const createdAt = s.getRange(row, 2).getValue() || now;
  const start = entry.start ? new Date(entry.start) : null;
  const end   = entry.end   ? new Date(entry.end)   : null;
  const duration = (start && end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
  // Prefer entry.user (typically the original starter sent back by the client)
  // over body.user (the device finishing the entry) so attribution stays with
  // whoever started the session.
  const userField = entry.user || user || s.getRange(row, 4).getValue();
  s.getRange(row, 1, 1, ENTRIES_HEADERS.length).setValues([[
    entry.id,
    createdAt,
    now,
    userField,
    entry.type,
    start, end, duration,
    entry.volume == null ? '' : Number(entry.volume),
    entry.source || '',
    !!entry.deleted,
    !!entry.isComfort,
  ]]);
  return {
    id: entry.id,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    updatedAt: now.toISOString(),
    user: userField,
    type: entry.type,
    start: start ? start.getTime() : null,
    end: end ? end.getTime() : null,
    durationSec: duration,
    volume: entry.volume == null ? null : Number(entry.volume),
    source: entry.source || null,
    deleted: !!entry.deleted,
    isComfort: !!entry.isComfort,
  };
}

function deleteEntry_(id, user) {
  const s = getSheet_(ENTRIES_SHEET, ENTRIES_HEADERS);
  const row = findRow_(s, id);
  if (row < 0) throw new Error('Entry not found: ' + id);
  s.getRange(row, 11).setValue(true);
  s.getRange(row, 3).setValue(new Date());
  if (user) s.getRange(row, 4).setValue(user);
  return id;
}

// ---------- users ----------

function getUsers_() {
  ensureInit_();
  const s = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  const data = s.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'user') {
      const v = String(data[i][1] || '').trim();
      if (v) users.push(v);
    }
  }
  return users;
}

function addUser_(name) {
  ensureInit_();
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Empty user name');
  if (trimmed.length > 40) throw new Error('Name too long');
  const s = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  const data = s.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'user' &&
        String(data[i][1]).trim().toLowerCase() === trimmed.toLowerCase()) {
      return getUsers_();
    }
  }
  s.appendRow(['user', trimmed]);
  return getUsers_();
}

// ---------- settings ----------

function readSettings_() {
  ensureInit_();
  const s = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  const data = s.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0]).trim();
    if (k === 'user' || k === 'passcode' || !k) continue;
    out[k] = data[i][1];
  }
  return out;
}

// ---------- weight ----------

function listWeights_() {
  const s = getSheet_(WEIGHT_SHEET, WEIGHT_HEADERS);
  const data = s.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1).map(rowToWeight_).filter(w => w && !w.deleted);
}

function rowToWeight_(r) {
  if (!r[0]) return null;
  return {
    id: String(r[0]),
    createdAt: r[1] instanceof Date ? r[1].toISOString() : (r[1] || null),
    updatedAt: r[2] instanceof Date ? r[2].toISOString() : (r[2] || null),
    // Use the sheet's timezone (not UTC) so the calendar date the user picked is preserved.
    date: r[3] instanceof Date
      ? Utilities.formatDate(r[3], SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd')
      : String(r[3] || '').slice(0, 10),
    weightG: r[4] ? Number(r[4]) : null,
    timing: String(r[5] || 'after'),
    deleted: r[6] === true || String(r[6]).toUpperCase() === 'TRUE',
  };
}

function addWeight_(weight) {
  if (!weight || !weight.weightG) throw new Error('Missing weight.weightG');
  const s = getSheet_(WEIGHT_SHEET, WEIGHT_HEADERS);
  const now = new Date();
  const id = Utilities.getUuid();
  const date = weight.date || todayStr_();
  s.appendRow([id, now, now, date, Number(weight.weightG), weight.timing || 'after', false]);
  return { id, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    date, weightG: Number(weight.weightG), timing: weight.timing || 'after', deleted: false };
}

function updateWeight_(weight) {
  if (!weight || !weight.id) throw new Error('Missing weight.id');
  const s = getSheet_(WEIGHT_SHEET, WEIGHT_HEADERS);
  const row = findWeightRow_(s, weight.id);
  if (row < 0) throw new Error('Weight not found: ' + weight.id);
  const now = new Date();
  const createdAt = s.getRange(row, 2).getValue() || now;
  s.getRange(row, 1, 1, WEIGHT_HEADERS.length).setValues([[
    weight.id, createdAt, now,
    weight.date, Number(weight.weightG), weight.timing || 'after', false,
  ]]);
  return { id: weight.id,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    updatedAt: now.toISOString(), date: weight.date,
    weightG: Number(weight.weightG), timing: weight.timing || 'after', deleted: false };
}

function deleteWeight_(id) {
  const s = getSheet_(WEIGHT_SHEET, WEIGHT_HEADERS);
  const row = findWeightRow_(s, id);
  if (row < 0) throw new Error('Weight not found: ' + id);
  s.getRange(row, 7).setValue(true);
  s.getRange(row, 3).setValue(new Date());
  return id;
}

function findWeightRow_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function todayStr_() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2_(d.getMonth()+1)}-${pad2_(d.getDate())}`;
}
function pad2_(n) { return n.toString().padStart(2, '0'); }

function updateSettings_(patch) {
  ensureInit_();
  if (!patch || typeof patch !== 'object') return readSettings_();
  const s = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  const data = s.getDataRange().getValues();
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0]).trim();
    if (k && k !== 'user') rowByKey[k] = i + 1;
  }
  Object.keys(patch).forEach(k => {
    if (k === 'user') return;
    const v = patch[k];
    if (rowByKey[k]) {
      s.getRange(rowByKey[k], 2).setValue(v);
    } else {
      s.appendRow([k, v]);
      rowByKey[k] = s.getLastRow();
    }
  });
  return readSettings_();
}
